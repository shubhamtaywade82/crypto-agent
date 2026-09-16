import type { MarketState } from '../domain/market/types.js';
import type { CircuitState } from '../domain/risk/risk-config.js';
import type { SetupCandidate } from './setup-engine.js';

/** Dynamic leverage band enforced by this module. */
export const MIN_LEVERAGE = 5;
export const MAX_LEVERAGE = 15;

/** Per-circuit-state hard cap on leverage. Never exceed these. */
const CIRCUIT_CAP: Record<CircuitState, number> = {
  NORMAL: MAX_LEVERAGE,
  CAUTION: 10,
  REDUCED: 7,
  HALTED: MIN_LEVERAGE,
  EMERGENCY: MIN_LEVERAGE,
};

/**
 * Compute a discrete leverage multiplier in [MIN_LEVERAGE, MAX_LEVERAGE]
 * from deterministic market signals. No guessing; each factor is bounded.
 *
 * Scoring (additive, then linearly mapped to leverage band):
 *   regime alignment bonus  : 0 – 3
 *   htfAlignment (0-3 TFs)  : 0 – 3
 *   confidence (0.05 – 0.95): 0 – 3
 *   microstructure agreement: 0 – 1
 *   volatility penalty      : 0 or -2
 *
 * Raw score range: [-2, 10] → mapped to [MIN_LEVERAGE, MAX_LEVERAGE].
 */
export const resolveLeverage = (
  state: MarketState,
  candidate: Pick<SetupCandidate, 'direction' | 'confidence' | 'htfAlignment'>,
  circuit: CircuitState
): number => {
  // PANIC and circuit halts are unconditional — no elevated leverage regardless of other signals.
  if (state.regime === 'PANIC' || state.btcRegime === 'PANIC') return MIN_LEVERAGE;
  const cap = CIRCUIT_CAP[circuit];
  if (cap <= MIN_LEVERAGE) return MIN_LEVERAGE;

  const regimeScore = regimeAlignmentScore(state, candidate.direction);
  const alignScore = Math.min(3, candidate.htfAlignment);       // 0-3
  const confScore = Math.round(candidate.confidence * 3);       // 0-3
  const microScore = microconfirmationScore(state, candidate.direction); // 0-1
  const volPenalty = isHighVolatility(state) ? -2 : 0;

  const rawScore = regimeScore + alignScore + confScore + microScore + volPenalty;
  // Clamp score to expected range before mapping
  const score = Math.max(-2, Math.min(10, rawScore));

  // Linear map: score -2 → MIN_LEVERAGE, score 10 → MAX_LEVERAGE
  const range = MAX_LEVERAGE - MIN_LEVERAGE;
  const scoreRange = 10 - (-2);
  const raw = MIN_LEVERAGE + ((score - (-2)) / scoreRange) * range;
  const lev = Math.round(raw);
  return Math.max(MIN_LEVERAGE, Math.min(cap, lev));
};

const regimeAlignmentScore = (
  state: MarketState,
  direction: 'LONG' | 'SHORT'
): number => {
  const { regime, btcRegime } = state;
  const isTrending =
    (direction === 'LONG' && (regime === 'TREND_UP' || regime === 'BREAKOUT')) ||
    (direction === 'SHORT' && (regime === 'TREND_DOWN' || regime === 'BREAKOUT'));
  const btcAligns =
    (direction === 'LONG' && btcRegime === 'TREND_UP') ||
    (direction === 'SHORT' && btcRegime === 'TREND_DOWN');
  return (isTrending ? 2 : 0) + (btcAligns ? 1 : 0);
};

const isHighVolatility = (state: MarketState): boolean =>
  state.timeframes['1h'].volatility.regime === 'HIGH_VOLATILITY' ||
  state.timeframes['15m'].volatility.regime === 'HIGH_VOLATILITY';

const microconfirmationScore = (
  state: MarketState,
  direction: 'LONG' | 'SHORT'
): number => {
  const m = state.microstructure;
  if (!m) return 0;
  const wantsBuy = direction === 'LONG';
  if (wantsBuy && m.flowBias === 'BUY' && m.imbalance > 0.1) return 1;
  if (!wantsBuy && m.flowBias === 'SELL' && m.imbalance < -0.1) return 1;
  return 0;
};
