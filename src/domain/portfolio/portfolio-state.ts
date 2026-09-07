/** Aggregated portfolio exposure snapshot fed into the RiskEngine. */
export interface SymbolExposure {
  readonly symbol: string;
  readonly notional: number;
  readonly direction: 'LONG' | 'SHORT';
  readonly cluster: string;
}

export interface PortfolioState {
  readonly equity: number;
  readonly availableMargin: number;
  readonly usedMargin: number;
  readonly openPositions: number;
  readonly grossExposure: number;
  readonly dailyRealizedPnl: number;
  readonly dailyLossPercent: number;
  readonly drawdownPercent: number;
  readonly lossStreak: number;
  readonly exposures: readonly SymbolExposure[];
  readonly updatedAt: number;
}

export const emptyPortfolio = (equity: number): PortfolioState => ({
  equity,
  availableMargin: equity,
  usedMargin: 0,
  openPositions: 0,
  grossExposure: 0,
  dailyRealizedPnl: 0,
  dailyLossPercent: 0,
  drawdownPercent: 0,
  lossStreak: 0,
  exposures: [],
  updatedAt: Date.now(),
});

/** Exposure already consumed by one symbol (absolute notional). */
export const symbolExposureOf = (p: PortfolioState, symbol: string): number =>
  p.exposures
    .filter((e) => e.symbol === symbol)
    .reduce((acc, e) => acc + Math.abs(e.notional), 0);

/** Exposure consumed by a correlation cluster (e.g. all high-beta alts). */
export const clusterExposureOf = (p: PortfolioState, cluster: string): number =>
  p.exposures
    .filter((e) => e.cluster === cluster)
    .reduce((acc, e) => acc + Math.abs(e.notional), 0);

/** Simple cluster heuristic: majors vs high-beta alts. */
export const clusterOf = (symbol: string): string => {
  const s = symbol.toUpperCase();
  if (s.startsWith('BTC')) return 'BTC';
  if (s.startsWith('ETH')) return 'ETH';
  return 'ALT';
};
