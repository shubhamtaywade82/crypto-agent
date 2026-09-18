import fs from 'node:fs';
import path from 'node:path';
import type { TradingKernel } from '../../kernel.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';
import { buildMarketState, buildMtfFromStore } from '../market-state-engine.js';
import { detectSetups } from '../setup-engine.js';
import type { MiFreshEvent } from '../mi-event-scan.js';
import type { Timeframe } from '../../domain/market/types.js';
import { analyzeMarket } from '../../agents/analyst-agent.js';
import { defaultModel, ollamaClient } from '../../config.js';
import { AlertDispatcher } from './dispatcher.js';
import { defaultSubscriptions, parseSubscriptions, type AlertSubscriptions } from './subscriptions.js';
import { SystemMonitor } from './system-monitor.js';
import { TradeMonitor } from './trade-monitor.js';
import { MarketTracker } from './market-tracker.js';
import { LevelTracker } from './level-tracker.js';
import { SetupTracker } from './setup-tracker.js';
import { MacroEngine } from './macro-engine.js';
import { ResearchReporter } from './research-reporter.js';
import { macroBlocksNewRisk, publishSignal } from './signal-path.js';
import { sharedMacroPolicy } from './macro-policy.js';
import type { SetupCandidate } from '../setup-engine.js';
import type { MtfResult } from '../mtf-engine.js';

export const loadSubscriptions = (): AlertSubscriptions => {
  try {
    if (process.env.NOTIFICATIONS_JSON) {
      return parseSubscriptions(JSON.parse(process.env.NOTIFICATIONS_JSON));
    }
  } catch { /* defaults */ }
  const file = process.env.NOTIFICATIONS_PATH
    ?? path.join(process.env.EVENT_STORE_PATH ?? '.data', 'notifications.json');
  try {
    if (fs.existsSync(file)) return parseSubscriptions(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch { /* defaults */ }
  return defaultSubscriptions();
};

export class AlertRuntime {
  readonly dispatcher: AlertDispatcher;
  readonly market: MarketTracker;
  readonly levels: LevelTracker;
  readonly setups: SetupTracker;
  private readonly system: SystemMonitor;
  private readonly trades: TradeMonitor;
  private readonly macro: MacroEngine;
  private readonly research: ResearchReporter;
  private unsub?: () => void;
  private timers: NodeJS.Timeout[] = [];
  private readonly seenConfirm = new Set<string>();
  private readonly seeded = new Set<string>();
  private started = false;

  constructor(private readonly kernel: TradingKernel, subs = loadSubscriptions()) {
    this.dispatcher = new AlertDispatcher(kernel.store, subs);
    this.market = new MarketTracker(this.dispatcher);
    this.levels = new LevelTracker(this.dispatcher);
    this.setups = new SetupTracker(this.dispatcher);
    this.trades = new TradeMonitor(this.dispatcher);
    this.macro = new MacroEngine(this.dispatcher, kernel.marketStore, kernelWatchSymbols);
    this.research = new ResearchReporter({
      dispatcher: this.dispatcher, performance: kernel.performance,
      ledger: kernel.ledger, strategies: kernel.strategies, subs,
    });
    this.system = new SystemMonitor({
      store: kernel.store,
      marketStore: kernel.marketStore,
      dispatcher: this.dispatcher,
      symbols: kernelWatchSymbols,
      maxStaleMs: Number(process.env.MARKET_MAX_STALE_MS ?? 45_000),
      stream: kernel.streams.market,
      killSwitch: kernel.killSwitch,
      limits: kernel.limits,
      dailyLossPercent: (): number => kernel.portfolio.peek().dailyLossPercent,
      drawdownPercent: (): number => kernel.performance.getDrawdownPercent(),
      lossStreak: (): number => kernel.performance.getLossStreak(),
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsub = this.kernel.store.onAppend((e) => {
      if (e.type.startsWith('alert.')) return;
      void this.trades.onKernelEvent(e);
    });
    this.timers.push(setInterval(() => { void this.system.tick(); }, 2_000));
    this.timers.push(setInterval(() => { void this.macro.tick(); }, 60_000));
    this.timers.push(setInterval(() => { void this.macro.refreshFeeds(); }, 900_000));
    this.timers.push(setInterval(() => { void this.research.tick(); }, 60_000));
    void this.system.tick();
    void this.macro.refreshFeeds().then(() => this.macro.tick());
    void this.research.tick();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.started = false;
  }

  async ingest(symbol: string, _timeframe: Timeframe, mi: readonly MiFreshEvent[]): Promise<void> {
    const mtf = await this.mtfOf(symbol);
    if (!mtf) return;
    if (!this.seeded.has(symbol)) {
      this.market.seed(symbol, mtf.state);
      this.seeded.add(symbol);
    }
    await this.market.observe(mtf.state);
    await this.levels.observe(mtf.state, mi);
    const setups = detectSetups(mtf, this.kernel.limits);
    const open = new Set(this.kernel.fills.openPositions().map((p) => p.symbol));
    const confirmed = await this.setups.observe(mtf.state, setups, mi, open);
    if (confirmed) await this.onConfirmed(confirmed, mtf);
  }

  private async mtfOf(symbol: string): Promise<MtfResult | undefined> {
    return buildMtfFromStore(this.kernel.marketStore, symbol)
      ?? await buildMarketState(this.kernel.provider, symbol).catch(() => undefined);
  }

  private async onConfirmed(candidate: SetupCandidate, mtf: MtfResult): Promise<void> {
    const key = `${candidate.id}:${candidate.type}`;
    if (this.seenConfirm.has(key)) return;
    this.seenConfirm.add(key);
    if (this.seenConfirm.size > 2000) {
      let dropped = 0;
      for (const k of this.seenConfirm) {
        this.seenConfirm.delete(k);
        if (++dropped >= 1000) break;
      }
    }
    if (macroBlocksNewRisk(sharedMacroPolicy)) return;
    const analysis = process.env.COUNCIL_LLM_ENABLED === 'false'
      ? undefined
      : await analyzeMarket(ollamaClient, defaultModel, mtf.state).catch(() => undefined);
    const trace = await this.kernel.runPipeline(candidate.symbol).catch(() => undefined);
    await publishSignal(this.dispatcher, candidate, mtf.state, {
      analysis, trace, macroNote: sharedMacroPolicy.note(),
    });
  }
}

let singleton: AlertRuntime | undefined;

export const getAlertRuntime = (kernel?: TradingKernel): AlertRuntime => {
  if (!singleton && kernel) singleton = new AlertRuntime(kernel);
  if (!singleton) throw new Error('AlertRuntime not booted');
  return singleton;
};

export const bootAlertRuntime = (kernel: TradingKernel): AlertRuntime => {
  if (!singleton) singleton = new AlertRuntime(kernel);
  singleton.start();
  return singleton;
};
