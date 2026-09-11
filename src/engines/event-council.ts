import type { Candle, Timeframe } from '../domain/market/types.js';
import type { CouncilTrigger } from './council-types.js';
import type { PipelineTrace } from './pipeline.js';
import { analyzeMarket } from '../agents/analyst-agent.js';
import { buildMarketState } from './market-state-engine.js';
import { scanMiEventsOnClose } from './mi-event-scan.js';
import { detectSetups } from './setup-engine.js';
import { getKernel, type TradingKernel } from '../kernel.js';
import { defaultModel, ollamaClient } from '../config.js';
import { eventTypesForCouncil } from './mi-evidence.js';
import { getMiEvidenceCache, warmMiEvidence } from './mi-evidence-cache.js';
import { sendCouncilTelegram } from '../notifications/council-telegram.js';
import type { BinanceMarketStream } from '../infrastructure/binance/market-stream.js';
import { kernelWatchSymbols } from '../kernel-streams.js';

export type { CouncilTrigger } from './council-types.js';

const councilEnabled = (): boolean => process.env.EVENT_COUNCIL_ENABLED !== 'false';

const cooldownMs = (): number => Number(process.env.COUNCIL_COOLDOWN_MS ?? 900_000);

const candleTfs = (): Set<Timeframe> => {
  const raw = process.env.COUNCIL_CANDLE_TFS ?? '1h,4h';
  return new Set(raw.split(',').map((s) => s.trim()) as Timeframe[]);
};

const miEventsEnabled = (): boolean => process.env.MI_EVENT_COUNCIL !== 'false';

const candleCloseCouncil = (): boolean => process.env.COUNCIL_CANDLE_CLOSE === 'true';

const symbolOf = (trigger: CouncilTrigger): string => {
  if (trigger.type === 'PRICE_WATCH') return trigger.event.condition.symbol;
  return trigger.symbol;
};

const triggerKey = (trigger: CouncilTrigger): string => {
  const sym = symbolOf(trigger);
  if (trigger.type === 'PRICE_WATCH') return `${sym}:watch`;
  if (trigger.type === 'CANDLE_CLOSE') return `${sym}:candle:${trigger.timeframe}`;
  if (trigger.type === 'MARKET_EVENT') return `${sym}:mi:${trigger.eventId}`;
  return `${sym}:${trigger.type}`;
};

const alwaysNotify = (status: PipelineTrace['status']): boolean =>
  status === 'EXECUTED' || status === 'APPROVED' || status === 'EXIT_SIGNALLED';

export class EventCouncil {
  private readonly lastFired = new Map<string, number>();
  private readonly lastRegime = new Map<string, string>();
  private readonly lastSetupCount = new Map<string, number>();
  private readonly seenMiEvents = new Map<string, Set<string>>();
  private wired = false;

  constructor(private readonly kernel: TradingKernel) {}

  wire(stream?: BinanceMarketStream): void {
    if (this.wired || !stream) return;
    this.wired = true;
    stream.onCandleClose((symbol, timeframe) => { void this.onCandleClose(symbol, timeframe); });
  }

  seedSnapshot(symbol: string, regime: string, setupCount: number): void {
    this.lastRegime.set(symbol, regime);
    this.lastSetupCount.set(symbol, setupCount);
  }

  private shouldFire(trigger: CouncilTrigger): boolean {
    if (!councilEnabled()) return false;
    const key = triggerKey(trigger);
    const last = this.lastFired.get(key) ?? 0;
    return Date.now() - last >= cooldownMs();
  }

  private markFired(trigger: CouncilTrigger): void {
    this.lastFired.set(triggerKey(trigger), Date.now());
  }

  async onCandleClose(symbol: string, timeframe: Timeframe): Promise<void> {
    if (!candleTfs().has(timeframe)) return;
    if (miEventsEnabled()) await this.scanMarketIntel(symbol, timeframe);
    else if (candleCloseCouncil()) {
      await this.dispatch({ type: 'CANDLE_CLOSE', symbol, timeframe });
    }
    await this.checkMarketShift(symbol);
  }

  private miSeenKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol.toUpperCase()}:${timeframe}`;
  }

  private seenMi(symbol: string, timeframe: Timeframe): Set<string> {
    const key = this.miSeenKey(symbol, timeframe);
    let set = this.seenMiEvents.get(key);
    if (!set) {
      set = new Set();
      this.seenMiEvents.set(key, set);
    }
    return set;
  }

  private rememberMi(symbol: string, timeframe: Timeframe, eventId: string): void {
    this.seenMi(symbol, timeframe).add(eventId);
  }

  private async candlesForScan(symbol: string, timeframe: Timeframe): Promise<readonly Candle[]> {
    const snap = this.kernel.marketStore.snapshot(symbol);
    const fromStore = snap?.candles[timeframe];
    if (fromStore && fromStore.length >= 20) return fromStore;
    return this.kernel.provider.getKlines(symbol, timeframe, 300);
  }

  private async scanMarketIntel(symbol: string, timeframe: Timeframe): Promise<void> {
    const sym = symbol.toUpperCase();
    const candles = await this.candlesForScan(sym, timeframe);
    const seen = this.seenMi(sym, timeframe);
    const fresh = scanMiEventsOnClose(sym, timeframe, candles, seen);
    for (const ev of fresh) {
      this.rememberMi(sym, timeframe, ev.eventId);
      this.kernel.store.append({
        type: 'mi.event.detected', symbol: sym,
        payload: { timeframe, eventType: ev.eventType, eventId: ev.eventId, label: ev.label },
      });
      await this.dispatch({
        type: 'MARKET_EVENT', symbol: sym, timeframe,
        eventType: ev.eventType, eventId: ev.eventId,
        direction: ev.direction, label: ev.label,
      });
    }
  }

  private async checkMarketShift(symbol: string): Promise<void> {
    const mtf = await buildMarketState(this.kernel.provider, symbol);
    const regime = mtf.state.regime;
    const prev = this.lastRegime.get(symbol);
    this.lastRegime.set(symbol, regime);
    if (prev && prev !== regime) {
      await this.dispatch({ type: 'REGIME_CHANGE', symbol, from: prev, to: regime });
    }
    const count = detectSetups(mtf, this.kernel.limits).length;
    const prevCount = this.lastSetupCount.get(symbol) ?? 0;
    this.lastSetupCount.set(symbol, count);
    if (count > 0 && count > prevCount) {
      await this.dispatch({ type: 'SETUP_DETECTED', symbol, count });
    }
  }

  async dispatch(trigger: CouncilTrigger): Promise<PipelineTrace | undefined> {
    if (!councilEnabled()) return undefined;
    const symbol = symbolOf(trigger);
    const skipCooldown = trigger.type === 'PRICE_WATCH' || trigger.type === 'MARKET_EVENT';
    if (!skipCooldown && !this.shouldFire(trigger)) return undefined;
    return this.kernel.lanes.enqueue(symbol, async () => {
      const trace = await this.kernel.runPipeline(symbol);
      if (!skipCooldown && !alwaysNotify(trace.status) && !this.shouldFire(trigger)) return trace;
      this.markFired(trigger);
      const types = eventTypesForCouncil(trigger, trace.setups);
      const evidence = await getMiEvidenceCache().blockFor(this.kernel, symbol, types);
      const analysis = trace.state
        ? await analyzeMarket(ollamaClient, defaultModel, trace.state, evidence)
        : trace.analysis;
      await sendCouncilTelegram(trigger, trace, analysis, evidence);
      this.kernel.store.append({
        type: 'council.notified', symbol,
        payload: { trigger: trigger.type, status: trace.status },
      });
      return trace;
    });
  }
}

let singleton: EventCouncil | undefined;

export const getEventCouncil = (): EventCouncil => {
  if (!singleton) singleton = new EventCouncil(getKernel());
  return singleton;
};

export const wireEventCouncil = (kernel: TradingKernel = getKernel()): EventCouncil => {
  const council = getEventCouncil();
  council.wire(kernel.streams.market);
  return council;
};

export const dispatchCouncil = (trigger: CouncilTrigger): Promise<PipelineTrace | undefined> =>
  getEventCouncil().dispatch(trigger);

export const bootEventCouncil = (kernel: TradingKernel = getKernel()): EventCouncil => {
  const council = wireEventCouncil(kernel);
  const symbols = kernelWatchSymbols();
  seedCouncilSymbols(symbols);
  warmMiEvidence(kernel, symbols);
  return council;
};

export const seedCouncilSymbols = (symbols: readonly string[]): void => {
  const kernel = getKernel();
  const council = getEventCouncil();
  for (const sym of symbols) {
    void buildMarketState(kernel.provider, sym).then((mtf) => {
      council.seedSnapshot(sym, mtf.state.regime, detectSetups(mtf, kernel.limits).length);
    });
  }
};
