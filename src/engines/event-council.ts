import type { Candle, Timeframe } from '../domain/market/types.js';
import type { CouncilTrigger } from './council-types.js';
import type { PipelineTrace } from './pipeline.js';
import { analyzeMarket } from '../agents/analyst-agent.js';
import { getKernel, type TradingKernel } from '../kernel.js';
import { defaultModel, ollamaClient } from '../config.js';
import { eventTypesForCouncil } from './mi-evidence.js';
import { getMiEvidenceCache, warmMiEvidence } from './mi-evidence-cache.js';
import type { BinanceMarketStream } from '../infrastructure/binance/market-stream.js';
import { kernelWatchSymbols } from '../kernel-streams.js';
import { emitCouncilPipelineTrace } from './pipeline-trace-bus.js';
import { scanMiEventsOnClose, type MiFreshEvent } from './mi-event-scan.js';
import { bootAlertRuntime, getAlertRuntime } from './alerts/runtime.js';

export type { CouncilTrigger } from './council-types.js';

const councilEnabled = (): boolean => process.env.EVENT_COUNCIL_ENABLED !== 'false';

const cooldownMs = (): number => Number(process.env.COUNCIL_COOLDOWN_MS ?? 900_000);

const candleTfs = (): Set<Timeframe> => {
  const raw = process.env.COUNCIL_CANDLE_TFS ?? '5m,15m,1h,4h';
  return new Set(raw.split(',').map((s) => s.trim()) as Timeframe[]);
};

const llmMinConfidence = (): number => Number(process.env.COUNCIL_LLM_MIN_CONFIDENCE ?? 0.75);

const shouldRunLlm = (trigger: CouncilTrigger, trace: PipelineTrace): boolean => {
  if (process.env.COUNCIL_LLM_ENABLED === 'false') return false;
  if (trigger.type === 'PRICE_WATCH') return true;
  if (trigger.type !== 'MARKET_EVENT') return false;
  return trace.setups.some((s) => s.confidence >= llmMinConfidence());
};

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

export class EventCouncil {
  private readonly lastFired = new Map<string, number>();
  private readonly seenMiEvents = new Map<string, Set<string>>();
  private wired = false;

  constructor(private readonly kernel: TradingKernel) {}

  wire(stream?: BinanceMarketStream): void {
    if (this.wired || !stream) return;
    this.wired = true;
    stream.onCandleClose((symbol, timeframe) => { void this.onCandleClose(symbol, timeframe); });
  }

  seedSnapshot(_symbol: string, _regime: string, _setupCount: number): void {
    /* regime/setup snapshots live on AlertRuntime trackers */
  }

  private shouldFire(trigger: CouncilTrigger): boolean {
    if (!councilEnabled()) return false;
    const last = this.lastFired.get(triggerKey(trigger)) ?? 0;
    return Date.now() - last >= cooldownMs();
  }

  private markFired(trigger: CouncilTrigger): void {
    this.lastFired.set(triggerKey(trigger), Date.now());
  }

  async onCandleClose(symbol: string, timeframe: Timeframe): Promise<void> {
    if (!candleTfs().has(timeframe)) return;
    const fresh = await this.scanMarketIntel(symbol, timeframe);
    try {
      await getAlertRuntime(this.kernel).ingest(symbol, timeframe, fresh);
    } catch {
      /* runtime may not be booted in unit tests */
    }
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
    const set = this.seenMi(symbol, timeframe);
    set.add(eventId);
    if (set.size <= 2000) return;
    const keep = [...set].slice(-1000);
    set.clear();
    for (const id of keep) set.add(id);
  }

  private async candlesForScan(symbol: string, timeframe: Timeframe): Promise<readonly Candle[]> {
    const snap = this.kernel.marketStore.snapshot(symbol);
    const fromStore = snap?.candles[timeframe];
    if (fromStore && fromStore.length >= 20) return fromStore;
    return this.kernel.provider.getKlines(symbol, timeframe, 300);
  }

  private async scanMarketIntel(symbol: string, timeframe: Timeframe): Promise<readonly MiFreshEvent[]> {
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
    }
    return fresh;
  }

  async dispatch(trigger: CouncilTrigger): Promise<PipelineTrace | undefined> {
    if (!councilEnabled()) return undefined;
    const symbol = symbolOf(trigger);
    const skipCooldown = trigger.type === 'PRICE_WATCH';
    if (!skipCooldown && !this.shouldFire(trigger)) return undefined;
    return this.kernel.lanes.enqueue(symbol, async () => {
      const trace = await this.kernel.runPipeline(symbol);
      emitCouncilPipelineTrace({ symbol, trace, trigger });
      this.markFired(trigger);
      if (trace.state && shouldRunLlm(trigger, trace)) {
        const types = eventTypesForCouncil(trigger, trace.setups);
        const evidence = await getMiEvidenceCache().blockFor(this.kernel, symbol, types);
        await analyzeMarket(ollamaClient, defaultModel, trace.state, evidence);
      }
      this.kernel.store.append({
        type: 'council.notified', symbol,
        payload: { trigger: trigger.type, status: trace.status, telegram: false },
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
  bootAlertRuntime(kernel);
  warmMiEvidence(kernel, kernelWatchSymbols());
  return council;
};

export const seedCouncilSymbols = (_symbols: readonly string[]): void => {
  /* no-op: AlertRuntime seeds on first ingest */
};
