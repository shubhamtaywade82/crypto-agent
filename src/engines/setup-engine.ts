import type { TradeDirection } from '../domain/primitives.js';
import type { MarketState, Timeframe } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import type { MtfResult } from './mtf-engine.js';
import { makeId } from '../domain/primitives.js';

type RawSetup = {
  readonly type: SetupType;
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly stopLoss: number;
  readonly liquidityTarget: number;
  readonly thesis: string;
  readonly invalidation: string;
};

export type SetupType =
  | 'PULLBACK_RECLAIM'
  | 'LIQUIDITY_SWEEP_REVERSAL'
  | 'BREAKOUT_RETEST'
  | 'TREND_CONTINUATION';

export interface SetupCandidate {
  readonly id: string;
  readonly type: SetupType;
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly orderType: 'MARKET' | 'LIMIT';
  readonly leverage: number;
  readonly rr: number;
  readonly htfAlignment: number;
  readonly confidence: number;
  readonly thesis: string;
  readonly invalidation: string;
  readonly warnings: readonly string[];
  readonly valid: boolean;
}

const rrOf = (direction: TradeDirection, entry: number, stop: number, tp: number): number => {
  const risk = direction === 'LONG' ? entry - stop : stop - entry;
  const reward = direction === 'LONG' ? tp - entry : entry - tp;
  return risk > 0 ? reward / risk : 0;
};

const alignedCount = (
  state: MarketState,
  direction: TradeDirection,
  tfs: readonly Timeframe[]
): number => {
  const want = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
  return tfs.filter((tf) => state.timeframes[tf].structure.trend === want).length;
};

/** Extend TP to min-RR only when liquidity target is materially close. */
const targetFor = (spec: {
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly stop: number;
  readonly liquidityTarget: number;
  readonly minRr: number;
}): { tp: number; extended: boolean } => {
  const { direction, entry, stop, liquidityTarget, minRr } = spec;
  const risk = direction === 'LONG' ? entry - stop : stop - entry;
  if (risk <= 0) return { tp: liquidityTarget, extended: false };
  const natural = direction === 'LONG' ? liquidityTarget - entry : entry - liquidityTarget;
  if (natural / risk >= minRr * 0.9) return { tp: liquidityTarget, extended: false };
  return {
    tp: direction === 'LONG' ? entry + minRr * risk : entry - minRr * risk,
    extended: true,
  };
};

const confidenceOf = (state: MarketState, direction: TradeDirection, alignment: number): number => {
  const volPenalty =
    state.timeframes['1h'].volatility.regime === 'HIGH_VOLATILITY' ? 0.15 : 0;
  const regimeBonus =
    (direction === 'LONG' && state.regime === 'TREND_UP') ||
    (direction === 'SHORT' && state.regime === 'TREND_DOWN') ? 0.08 : 0;
  return Math.max(0.05, Math.min(0.95, 0.4 + 0.1 * alignment + regimeBonus - volPenalty));
};

const finalize = (
  state: MarketState,
  base: RawSetup,
  limits: RiskLimits
): SetupCandidate => {
  const alignment = alignedCount(state, base.direction, ['4h', '1h', '15m']);
  const { tp, extended } = targetFor({
    direction: base.direction, entry: base.entry, stop: base.stopLoss,
    liquidityTarget: base.liquidityTarget, minRr: limits.minRiskRewardRatio,
  });
  const rr = rrOf(base.direction, base.entry, base.stopLoss, tp);
  const structuralOk =
    base.direction === 'LONG'
      ? base.stopLoss < base.entry && tp > base.entry
      : base.stopLoss > base.entry && tp < base.entry;
  return {
    id: makeId(`setup-${base.type.toLowerCase()}`),
    type: base.type,
    symbol: state.symbol,
    direction: base.direction,
    entry: base.entry,
    stopLoss: base.stopLoss,
    takeProfit: tp,
    orderType: 'MARKET',
    leverage: 1,
    rr,
    htfAlignment: alignment,
    confidence: confidenceOf(state, base.direction, alignment),
    thesis: base.thesis + (extended ? ' [TP extended to satisfy min RR]' : ''),
    invalidation: base.invalidation,
    warnings: extended ? ['take-profit extended beyond liquidity target'] : [],
    valid: structuralOk && rr >= limits.minRiskRewardRatio,
  };
};



/** All detectors; each returns null when preconditions are absent. */
const detectors: readonly ((
  state: MarketState,
  mtf: MtfResult
) => RawSetup | null)[] = [
  (state): RawSetup | null => {
    const s15 = state.timeframes['15m'].structure;
    const s5 = state.timeframes['5m'];
    if (s15.trend !== 'BULLISH' || !s5.momentum || s5.lastClose <= s5.structure.swingLow) return null;
    if (s5.momentum.macdHist <= 0 || s5.momentum.rsi < 45) return null;
    return {
      type: 'PULLBACK_RECLAIM', direction: 'LONG',
      entry: s5.lastClose, stopLoss: s5.structure.swingLow,
      liquidityTarget: state.liquidity.nearestHigh,
      thesis: `15m bullish pullback reclaimed on 5m; MACD hist positive, RSI ${s5.momentum.rsi.toFixed(0)}`,
      invalidation: `5m close below ${s5.structure.swingLow}`,
    };
  },
  (state): RawSetup | null => {
    const s5 = state.timeframes['5m'];
    if (!state.liquidity.sweepDetected || state.liquidity.sweepSide !== 'SELL_SIDE') return null;
    if (!s5.structure.choch && s5.structure.trend !== 'BULLISH') return null;
    const stop = Math.min(s5.structure.swingLow, s5.lastClose * 0.995);
    return {
      type: 'LIQUIDITY_SWEEP_REVERSAL', direction: 'LONG',
      entry: s5.lastClose, stopLoss: stop,
      liquidityTarget: state.liquidity.nearestHigh,
      thesis: 'Sell-side liquidity swept then 5m CHoCH up — reversal long',
      invalidation: `close below sweep low ${stop}`,
    };
  },
  (state): RawSetup | null => {
    const s1h = state.timeframes['1h'].structure;
    const s5 = state.timeframes['5m'];
    if (!s1h.bos || s1h.trend !== 'BULLISH') return null;
    if (s5.lastClose < s1h.swingHigh * 0.999) return null;
    return {
      type: 'BREAKOUT_RETEST', direction: 'LONG',
      entry: s5.lastClose, stopLoss: Math.min(s1h.swingHigh, state.timeframes['5m'].structure.swingLow),
      liquidityTarget: state.liquidity.nearestHigh,
      thesis: `1h BOS above ${s1h.swingHigh}; 5m holding above broken level — breakout-retest long`,
      invalidation: `5m close back below ${s1h.swingHigh}`,
    };
  },
  (state): RawSetup | null => {
    const s15 = state.timeframes['15m'].structure;
    const s5 = state.timeframes['5m'];
    if (s15.trend !== 'BULLISH' || !s15.bos) return null;
    if (s5.structure.trend !== 'BULLISH') return null;
    return {
      type: 'TREND_CONTINUATION', direction: 'LONG',
      entry: s5.lastClose, stopLoss: s5.structure.swingLow,
      liquidityTarget: state.liquidity.nearestHigh,
      thesis: '15m BOS continuation in aligned uptrend',
      invalidation: `15m CHoCH (close below ${s15.swingLow})`,
    };
  },
];

const shortDetectors: readonly ((
  state: MarketState,
  mtf: MtfResult
) => RawSetup | null)[] = [
  (state): RawSetup | null => {
    const s15 = state.timeframes['15m'].structure;
    const s5 = state.timeframes['5m'];
    if (s15.trend !== 'BEARISH') return null;
    if (s5.lastClose >= s5.structure.swingHigh) return null;
    if (s5.momentum.macdHist >= 0 || s5.momentum.rsi > 55) return null;
    return {
      type: 'PULLBACK_RECLAIM', direction: 'SHORT',
      entry: s5.lastClose, stopLoss: s5.structure.swingHigh,
      liquidityTarget: state.liquidity.nearestLow,
      thesis: `15m bearish pullback rejected on 5m; MACD hist negative, RSI ${s5.momentum.rsi.toFixed(0)}`,
      invalidation: `5m close above ${s5.structure.swingHigh}`,
    };
  },
  (state): RawSetup | null => {
    const s5 = state.timeframes['5m'];
    if (!state.liquidity.sweepDetected || state.liquidity.sweepSide !== 'BUY_SIDE') return null;
    if (!s5.structure.choch && s5.structure.trend !== 'BEARISH') return null;
    const stop = Math.max(state.timeframes['5m'].structure.swingHigh, s5.lastClose * 1.005);
    return {
      type: 'LIQUIDITY_SWEEP_REVERSAL', direction: 'SHORT',
      entry: s5.lastClose, stopLoss: stop,
      liquidityTarget: state.liquidity.nearestLow,
      thesis: 'Buy-side liquidity swept then 5m CHoCH down — reversal short',
      invalidation: `close above sweep high ${stop}`,
    };
  },
  (state): RawSetup | null => {
    const s1h = state.timeframes['1h'].structure;
    const s5 = state.timeframes['5m'];
    if (!s1h.bos || s1h.trend !== 'BEARISH') return null;
    if (s5.lastClose > s1h.swingLow * 1.001) return null;
    return {
      type: 'BREAKOUT_RETEST', direction: 'SHORT',
      entry: s5.lastClose, stopLoss: Math.max(s1h.swingLow, s5.structure.swingHigh),
      liquidityTarget: state.liquidity.nearestLow,
      thesis: `1h BOS below ${s1h.swingLow}; 5m holding below broken level — breakdown-retest short`,
      invalidation: `5m close back above ${s1h.swingLow}`,
    };
  },
];

/**
 * Detect deterministic candidate setups from the MTF state and rank them.
 * Only structurally valid candidates (RR >= min) are returned, sorted by
 * confidence descending. Regime gates: no longs in TREND_DOWN etc.
 */
export const detectSetups = (
  mtf: MtfResult,
  limits: RiskLimits
): readonly SetupCandidate[] => {
  const state = mtf.state;
  const regimeBlocksLongs = state.regime === 'TREND_DOWN' || state.regime === 'PANIC';
  const regimeBlocksShorts = state.regime === 'TREND_UP' || state.regime === 'PANIC';
  const btcBlocks = state.btcRegime === 'PANIC';

  const candidates: SetupCandidate[] = [];
  const run = (
    fns: readonly ((state: MarketState, mtf: MtfResult) => RawSetup | null)[],
    blocked: boolean
  ): void => {
    if (blocked || btcBlocks) return;
    for (const fn of fns) {
      const raw = fn(state, mtf);
      if (raw) candidates.push(finalize(state, raw, limits));
    }
  };
  run(detectors, regimeBlocksLongs);
  run(shortDetectors, regimeBlocksShorts);

  return candidates
    .filter((c) => c.valid)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
};
