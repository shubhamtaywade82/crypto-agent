import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import type { Candle, Timeframe } from '../domain/market/types.js';
import type { MarketStateStore } from './market-state-store.js';

export interface EvidenceDeps {
  readonly provider: IMarketDataProvider;
  readonly marketStore: MarketStateStore;
}
import {
  evidenceStudyTf,
  formatEvidenceBlock,
  pickEvidenceResults,
  runEvidenceStudy,
  type EvidenceSnapshot,
} from './mi-evidence.js';

const cacheKey = (symbol: string, tf: Timeframe): string => `${symbol.toUpperCase()}:${tf}`;

const ttlMs = (): number => Number(process.env.MI_EVIDENCE_TTL_MS ?? 3_600_000);

export const evidenceEnabled = (): boolean => process.env.MI_EVIDENCE_ENABLED !== 'false';

export class MiEvidenceCache {
  private readonly entries = new Map<string, EvidenceSnapshot>();
  private readonly inflight = new Map<string, Promise<EvidenceSnapshot | undefined>>();

  peek(symbol: string, tf: Timeframe = evidenceStudyTf()): EvidenceSnapshot | undefined {
    const snap = this.entries.get(cacheKey(symbol, tf));
    if (!snap || Date.now() - snap.refreshedAt > ttlMs()) return undefined;
    return snap;
  }

  private async loadCandles(
    deps: EvidenceDeps,
    symbol: string,
    tf: Timeframe
  ): Promise<readonly Candle[]> {
    const snap = deps.marketStore.snapshot(symbol);
    const fromStore = snap?.candles[tf];
    if (fromStore && fromStore.length >= 100) return fromStore;
    return deps.provider.getKlines(symbol, tf, 300);
  }

  async refresh(
    deps: EvidenceDeps,
    symbol: string,
    tf: Timeframe = evidenceStudyTf()
  ): Promise<EvidenceSnapshot | undefined> {
    const sym = symbol.toUpperCase();
    const key = cacheKey(sym, tf);
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const job = (async (): Promise<EvidenceSnapshot | undefined> => {
      try {
        const candles = await this.loadCandles(deps, sym, tf);
        const snap = runEvidenceStudy(sym, tf, candles);
        if (snap) this.entries.set(key, snap);
        return snap;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }

  async getOrRefresh(
    deps: EvidenceDeps,
    symbol: string,
    tf: Timeframe = evidenceStudyTf()
  ): Promise<EvidenceSnapshot | undefined> {
    return this.peek(symbol, tf) ?? await this.refresh(deps, symbol, tf);
  }

  async blockFor(
    deps: EvidenceDeps,
    symbol: string,
    eventTypes: readonly string[],
    tf: Timeframe = evidenceStudyTf()
  ): Promise<string | undefined> {
    if (!evidenceEnabled()) return undefined;
    const snap = await this.getOrRefresh(deps, symbol, tf);
    if (!snap) return undefined;
    return formatEvidenceBlock(pickEvidenceResults(snap, eventTypes));
  }
}

let singleton: MiEvidenceCache | undefined;

export const getMiEvidenceCache = (): MiEvidenceCache => {
  if (!singleton) singleton = new MiEvidenceCache();
  return singleton;
};

export const warmMiEvidence = (deps: EvidenceDeps, symbols: readonly string[]): void => {
  if (!evidenceEnabled()) return;
  const tf = evidenceStudyTf();
  for (const sym of symbols) void getMiEvidenceCache().refresh(deps, sym, tf);
};
