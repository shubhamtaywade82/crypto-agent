import type { TradeDirection } from '../domain/primitives.js';
import type { MarketState, Trend } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import type { MtfResult } from '../engines/mtf-engine.js';
import { detectSetups } from '../engines/setup-engine.js';
import {
  FUNNEL_CONFIDENCE_THRESHOLD,
  type GateResult,
  type SetupFunnelObservation,
} from './funnel-types.js';

const wantTrend = (d: TradeDirection): Trend => (d === 'LONG' ? 'BULLISH' : 'BEARISH');

const fail = (reason: string): GateResult => ({ observed: true, passed: false, reason });
const pass = (): GateResult => ({ observed: true, passed: true });

const trendGate = (trend: Trend, want: Trend, tag: string): GateResult =>
  trend === want ? pass() : fail(`${tag}_${trend}`);

const alignedCount = (state: MarketState, want: Trend): number =>
  (['4h', '1h', '15m'] as const).filter((tf) => state.timeframes[tf].structure.trend === want).length;

/** Frozen copy of setup-engine confidenceOf (do not drift). */
const confidenceOf = (state: MarketState, direction: TradeDirection, alignment: number): number => {
  const volPenalty = state.timeframes['1h'].volatility.regime === 'HIGH_VOLATILITY' ? 0.15 : 0;
  const regimeBonus =
    (direction === 'LONG' && state.regime === 'TREND_UP') ||
    (direction === 'SHORT' && state.regime === 'TREND_DOWN') ? 0.08 : 0;
  return Math.max(0.05, Math.min(0.95, 0.4 + 0.1 * alignment + regimeBonus - volPenalty));
};

const diagnosticRr = (state: MarketState, direction: TradeDirection): number => {
  const entry = state.price.last;
  const stop = direction === 'LONG' ? state.timeframes['5m'].structure.swingLow : state.timeframes['5m'].structure.swingHigh;
  const tp = direction === 'LONG' ? state.liquidity.nearestHigh : state.liquidity.nearestLow;
  const risk = direction === 'LONG' ? entry - stop : stop - entry;
  const reward = direction === 'LONG' ? tp - entry : entry - tp;
  return risk > 0 ? reward / risk : 0;
};

const retestGate = (state: MarketState, direction: TradeDirection): GateResult => {
  const close = state.timeframes['5m'].lastClose;
  const s1h = state.timeframes['1h'].structure;
  const s5 = state.timeframes['5m'].structure;
  if (direction === 'LONG') {
    const hold = close >= s1h.swingHigh * 0.999;
    const pull = close <= s5.swingLow * 1.005;
    return hold || pull ? pass() : fail('NO_RETEST');
  }
  const hold = close <= s1h.swingLow * 1.001;
  const pull = close >= s5.swingHigh * 0.995;
  return hold || pull ? pass() : fail('NO_RETEST');
};

const triggerGate = (state: MarketState, direction: TradeDirection): GateResult => {
  const s5 = state.timeframes['5m'];
  if (s5.structure.choch) return pass();
  if (direction === 'LONG' && s5.momentum.macdHist > 0 && s5.momentum.rsi >= 45) return pass();
  if (direction === 'SHORT' && s5.momentum.macdHist < 0 && s5.momentum.rsi <= 55) return pass();
  return fail('NO_5M_TRIGGER');
};

const riskGate = (state: MarketState, direction: TradeDirection): GateResult => {
  if (state.btcRegime === 'PANIC') return fail('BTC_PANIC');
  if (state.regime === 'PANIC') return fail('REGIME_PANIC');
  if (direction === 'LONG' && (state.regime === 'TREND_DOWN')) return fail('REGIME_BLOCKS_LONG');
  if (direction === 'SHORT' && (state.regime === 'TREND_UP')) return fail('REGIME_BLOCKS_SHORT');
  return pass();
};

const firstReject = (obs: Omit<SetupFunnelObservation, 'final'>): string | undefined => {
  if (!obs.macro.passed) return obs.macro.reason;
  if (!obs.bias.passed) return obs.bias.reason;
  if (!obs.structure.passed) return obs.structure.reason;
  if (!obs.liquidity.passed) return obs.liquidity.reason;
  if (!obs.retest.passed) return obs.retest.reason;
  if (!obs.trigger.passed) return obs.trigger.reason;
  if (!obs.confluence.passed) return 'CONFLUENCE_BELOW_THRESHOLD';
  if (!obs.rr.passed) return 'RR_BELOW_THRESHOLD';
  if (!obs.risk.passed) return obs.risk.reason;
  return undefined;
};

export const evaluateDirection = (
  mtf: MtfResult,
  direction: TradeDirection,
  limits: RiskLimits,
  at: number
): SetupFunnelObservation => {
  const state = mtf.state;
  const want = wantTrend(direction);
  const sweepWant = direction === 'LONG' ? 'SELL_SIDE' : 'BUY_SIDE';
  const alignment = alignedCount(state, want);
  const score = confidenceOf(state, direction, alignment);
  const rr = diagnosticRr(state, direction);
  const live = detectSetups(mtf, limits).some((c) => c.valid && c.direction === direction);
  const body = {
    timestamp: at,
    symbol: state.symbol,
    direction,
    macro: trendGate(state.timeframes['4h'].structure.trend, want, '4H'),
    bias: trendGate(state.timeframes['1h'].structure.trend, want, '1H'),
    structure: trendGate(state.timeframes['15m'].structure.trend, want, '15M'),
    liquidity: state.liquidity.sweepDetected && state.liquidity.sweepSide === sweepWant
      ? pass() : fail(state.liquidity.sweepDetected ? 'SWEEP_WRONG_SIDE' : 'NO_SWEEP'),
    zone: { observed: false, passed: false, reason: 'FVG_OB_DETECTOR_ABSENT' } as const,
    retest: retestGate(state, direction),
    trigger: triggerGate(state, direction),
    confluence: { score, threshold: FUNNEL_CONFIDENCE_THRESHOLD, passed: score >= FUNNEL_CONFIDENCE_THRESHOLD },
    rr: { value: rr, threshold: limits.minRiskRewardRatio, passed: rr >= limits.minRiskRewardRatio },
    risk: riskGate(state, direction),
  };
  const rejection = live ? undefined : (firstReject(body) ?? 'NO_PRODUCTION_SETUP');
  return { ...body, final: { executable: live, rejectionReason: rejection } };
};

const sequentialScore = (o: SetupFunnelObservation): number =>
  [o.macro, o.bias, o.structure, o.liquidity, o.retest, o.trigger]
    .filter((g) => g.passed).length
  + (o.confluence.passed ? 1 : 0) + (o.rr.passed ? 1 : 0) + (o.risk.passed ? 1 : 0);

/** One bar: keep the direction that progresses furthest; executable follows detectSetups. */
export const evaluateFunnelBar = (
  mtf: MtfResult,
  limits: RiskLimits,
  at = mtf.state.capturedAt
): SetupFunnelObservation => {
  const long = evaluateDirection(mtf, 'LONG', limits, at);
  const short = evaluateDirection(mtf, 'SHORT', limits, at);
  if (long.final.executable) return long;
  if (short.final.executable) return short;
  return sequentialScore(long) >= sequentialScore(short) ? long : short;
};
