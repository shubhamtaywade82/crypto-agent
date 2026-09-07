/** Circuit-breaker state machine (global risk governor). */
export type CircuitState = 'NORMAL' | 'CAUTION' | 'REDUCED' | 'HALTED' | 'EMERGENCY';

/** Prop-firm style default envelope for the INR CoinDCX account. */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTradePercent: 0.25,
  maxDailyLossPercent: 1.0,
  maxDrawdownPercent: 5.0,
  maxLeverage: 2,
  minRiskRewardRatio: 2.5,
  maxConcurrentPositions: 2,
  maxNotionalPerTrade: 250_000,
  maxSymbolExposurePercent: 20,
  maxPortfolioGrossExposurePercent: 50,
  maxCorrelatedExposurePercent: 35,
  maxLossStreak: 3,
  feeRateTaker: 0.0005,
  feeRateMaker: 0.0002,
  slippageBufferRate: 0.0005,
};

/** Hard risk envelope — every field is a circuit rule, not a suggestion. */
export interface RiskLimits {
  /** Max account equity risked on one trade (percent, e.g. 0.25 = 0.25%). */
  readonly maxRiskPerTradePercent: number;
  /** Max equity loss in one trading day (percent) before HALTED. */
  readonly maxDailyLossPercent: number;
  /** Max peak-to-valley drawdown (percent) before EMERGENCY. */
  readonly maxDrawdownPercent: number;
  /** Max allowed leverage per position. */
  readonly maxLeverage: number;
  /** Minimum reward:risk ratio accepted by the TradeValidator. */
  readonly minRiskRewardRatio: number;
  /** Max simultaneous open positions. */
  readonly maxConcurrentPositions: number;
  /** Max notional value (quote currency) per single order. */
  readonly maxNotionalPerTrade: number;
  /** Max gross exposure on one symbol as % of equity. */
  readonly maxSymbolExposurePercent: number;
  /** Max gross exposure across all symbols as % of equity. */
  readonly maxPortfolioGrossExposurePercent: number;
  /** Max exposure in correlated assets (alt cluster) as % of equity. */
  readonly maxCorrelatedExposurePercent: number;
  /** Consecutive losses that trip REDUCED state. */
  readonly maxLossStreak: number;
  /** Taker fee rate (e.g. 0.0005 = 0.05%) used in sizing. */
  readonly feeRateTaker: number;
  /** Maker fee rate used in sizing. */
  readonly feeRateMaker: number;
  /** Slippage buffer rate applied to stop distance in sizing. */
  readonly slippageBufferRate: number;
}

export const RISK_ENV_OVERRIDES: Readonly<Record<string, keyof RiskLimits>> = {
  RISK_MAX_PER_TRADE_PCT: 'maxRiskPerTradePercent',
  RISK_MAX_DAILY_LOSS_PCT: 'maxDailyLossPercent',
  RISK_MAX_DRAWDOWN_PCT: 'maxDrawdownPercent',
  RISK_MAX_LEVERAGE: 'maxLeverage',
  RISK_MIN_RR: 'minRiskRewardRatio',
  RISK_MAX_POSITIONS: 'maxConcurrentPositions',
  RISK_MAX_NOTIONAL: 'maxNotionalPerTrade',
  RISK_MAX_LOSS_STREAK: 'maxLossStreak',
};

/** Merge env overrides onto the default envelope (numbers only). */
export const loadRiskLimits = (env: NodeJS.ProcessEnv = process.env): RiskLimits => {
  const merged: Record<string, number> = { ...DEFAULT_RISK_LIMITS };
  for (const [envKey, limitKey] of Object.entries(RISK_ENV_OVERRIDES)) {
    const raw = env[envKey];
    if (raw !== undefined && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) merged[limitKey] = parsed;
    }
  }
  return merged as unknown as RiskLimits;
};

/** Derive circuit state from realized damage. */
export const deriveCircuitState = (
  dailyLossPercent: number,
  drawdownPercent: number,
  lossStreak: number,
  limits: RiskLimits
): CircuitState => {
  if (drawdownPercent >= limits.maxDrawdownPercent) return 'EMERGENCY';
  if (dailyLossPercent >= limits.maxDailyLossPercent) return 'HALTED';
  if (dailyLossPercent >= limits.maxDailyLossPercent * 0.75) return 'REDUCED';
  if (dailyLossPercent >= limits.maxDailyLossPercent * 0.5) return 'CAUTION';
  if (lossStreak >= limits.maxLossStreak) return 'REDUCED';
  if (lossStreak >= Math.max(1, limits.maxLossStreak - 1)) return 'CAUTION';
  return 'NORMAL';
};

/** Risk budget multiplier applied per circuit state. */
export const circuitRiskMultiplier = (state: CircuitState): number => {
  switch (state) {
    case 'NORMAL': return 1;
    case 'CAUTION': return 0.75;
    case 'REDUCED': return 0.5;
    case 'HALTED': return 0;
    case 'EMERGENCY': return 0;
  }
};
