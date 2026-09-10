import type { BookLevel, FlowBias, MicrostructureView, TradePrint } from '../domain/market/microstructure.js';
import type { TradeDirection } from '../domain/primitives.js';

const sumQty = (levels: readonly BookLevel[]): number =>
  levels.reduce((acc, l) => acc + l.qty, 0);

const flowOf = (buy: number, sell: number): FlowBias => {
  const total = buy + sell;
  if (total <= 0) return 'NEUTRAL';
  const ratio = (buy - sell) / total;
  if (ratio > 0.15) return 'BUY';
  if (ratio < -0.15) return 'SELL';
  return 'NEUTRAL';
};

/** Build a microstructure view from top-of-book depth and recent prints. */
export const computeMicrostructure = (
  depth: { readonly bids: readonly BookLevel[]; readonly asks: readonly BookLevel[] },
  trades: readonly TradePrint[],
  mid: number,
  at?: number
): MicrostructureView => {
  const capturedAt = at ?? Date.now();
  const { bids, asks } = depth;
  const bidDepth = sumQty(bids);
  const askDepth = sumQty(asks);
  const depthTotal = bidDepth + askDepth;
  const imbalance = depthTotal > 0 ? (bidDepth - askDepth) / depthTotal : 0;
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;

  let buyVolume = 0;
  let sellVolume = 0;
  for (const t of trades) {
    const notional = t.price * t.qty;
    if (t.buyerIsMaker) sellVolume += notional;
    else buyVolume += notional;
  }

  return {
    spreadBps: Number(spreadBps.toFixed(2)),
    bidDepth: Number(bidDepth.toFixed(4)),
    askDepth: Number(askDepth.toFixed(4)),
    imbalance: Number(imbalance.toFixed(4)),
    buyVolume: Number(buyVolume.toFixed(2)),
    sellVolume: Number(sellVolume.toFixed(2)),
    tradeDelta: Number((buyVolume - sellVolume).toFixed(2)),
    flowBias: flowOf(buyVolume, sellVolume),
    updatedAt: capturedAt,
  };
};

/** Confidence nudge when order flow fights the proposed direction. */
export const microstructureConfidenceDelta = (
  view: MicrostructureView | undefined,
  direction: TradeDirection
): number => {
  if (!view) return 0;
  const wantsBuy = direction === 'LONG';
  if (wantsBuy && view.imbalance < -0.2 && view.flowBias === 'SELL') return -0.1;
  if (!wantsBuy && view.imbalance > 0.2 && view.flowBias === 'BUY') return -0.1;
  if (wantsBuy && view.flowBias === 'BUY' && view.imbalance > 0.1) return 0.05;
  if (!wantsBuy && view.flowBias === 'SELL' && view.imbalance < -0.1) return 0.05;
  return 0;
};
