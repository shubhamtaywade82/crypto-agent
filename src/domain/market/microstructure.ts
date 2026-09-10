/** Single price level in the order book. */
export interface BookLevel {
  readonly price: number;
  readonly qty: number;
}

/** Normalized agg-trade print (buyer-is-maker flag => sell aggressor). */
export interface TradePrint {
  readonly price: number;
  readonly qty: number;
  readonly at: number;
  readonly buyerIsMaker: boolean;
}

export type FlowBias = 'BUY' | 'SELL' | 'NEUTRAL';

/** Deterministic microstructure snapshot fed by depth + agg-trade streams. */
export interface MicrostructureView {
  readonly spreadBps: number;
  readonly bidDepth: number;
  readonly askDepth: number;
  /** Bid-heavy is positive; range [-1, 1]. */
  readonly imbalance: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  readonly tradeDelta: number;
  readonly flowBias: FlowBias;
  readonly updatedAt: number;
}
