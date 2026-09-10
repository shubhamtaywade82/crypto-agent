import type { Candle, Timeframe } from '../../domain/market/types.js';
import type { BookLevel, TradePrint } from '../../domain/market/microstructure.js';
import type { ContractSpec } from '../../domain/futures/contract-spec.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';

/** What a broker/provider is allowed to do. Enforced by the kernel. */
export type BrokerCapability =
  | 'MARKET_DATA'
  | 'ORDER_EXECUTION'
  | 'POSITIONS'
  | 'ACCOUNT'
  | 'PRIVATE_STREAMS';

export interface PlaceOrderRequest {
  /** Idempotency key — mapped to venue client_order_id. */
  readonly intentId: string;
  readonly pair: string;
  readonly side: 'buy' | 'sell';
  readonly orderType: 'market_order' | 'limit_order';
  readonly quantity: number;
  readonly price?: number;
  readonly leverage: number;
  readonly marginType: 'isolated' | 'cross';
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly reduceOnly?: boolean;
  // ---- execution-quality contract (kernel v3) ----
  /** Reference price the decision was priced against (USDT). */
  readonly expectedPrice?: number;
  /** Max tolerated execution deviation from expectedPrice, in basis points. */
  readonly maxSlippageBps?: number;
  /** Strategy identity for audit and per-strategy performance attribution. */
  readonly strategyId?: string;
  readonly strategyVersion?: string;
  /** Decision lineage: the risk decision that authorized this order. */
  readonly decisionId?: string;
  /** Entry, exit or reduce intent. */
  readonly intentType?: 'ENTRY' | 'EXIT' | 'REDUCE';
  /** Venue time-in-force override (gtc | ioc | fok). */
  readonly timeInForce?: 'gtc' | 'ioc' | 'fok';
  /** Post-only (maker) execution request. */
  readonly postOnly?: boolean;
  /** Wall-clock expiry: venue must not act on this order after this time. */
  readonly expiry?: number;
}

/**
 * Truthful three-state result of an order lookup at the venue.
 *
 * `undefined`-style lookups conflate two very different situations:
 * the order genuinely not existing (safe to apply missing-order policy)
 * and the lookup itself failing (safe to do NOTHING). Distinguishing
 * them is what keeps reconciliation from cancelling live orders during
 * an exchange outage.
 */
export type BrokerLookupResult =
  | { readonly kind: 'FOUND'; readonly order: BrokerOrder }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'LOOKUP_FAILED'; readonly reason: string };

export interface BrokerOrder {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly pair: string;
  readonly status: OrderStatus;
  readonly filledQuantity: number;
  readonly avgFillPrice?: number;
}

export interface BrokerPosition {
  readonly positionId: string;
  readonly pair: string;
  readonly side: 'long' | 'short';
  readonly size: number;
  readonly entryPrice: number;
  readonly markPrice?: number;
  readonly unrealizedPnl?: number;
  readonly leverage?: number;
}

export interface BrokerBalance {
  readonly currency: string;
  readonly total: number;
  readonly available: number;
}

/** Read-only market intelligence (Binance in this system). */
export interface IMarketDataProvider {
  readonly id: string;
  readonly capabilities: readonly BrokerCapability[];
  getKlines(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  getTickerPrice(symbol: string): Promise<number>;
  getMarkIndex(symbol: string): Promise<{ mark: number; index: number }>;
  getFundingRate(symbol: string): Promise<number>;
  getOpenInterest(symbol: string): Promise<{ oi: number; changePct: number }>;
  getOrderBookDepth(symbol: string, limit: number): Promise<{ bids: BookLevel[]; asks: BookLevel[] }>;
  getAggTrades(symbol: string, limit: number): Promise<TradePrint[]>;
}

/** Order/position/account execution (CoinDCX in this system). */
export interface IExecutionBroker {
  readonly id: string;
  readonly capabilities: readonly BrokerCapability[];
  getInstrument(pair: string): Promise<ContractSpec | undefined>;
  placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder>;
  cancelOrder(pair: string, orderId: string): Promise<void>;
  /**
   * Three-state truth lookup. Implementations MUST distinguish
   * NOT_FOUND (venue answered: no such order) from LOOKUP_FAILED
   * (venue unreachable / auth / rate limit).
   */
  lookupOrder(pair: string, clientOrderId: string): Promise<BrokerLookupResult>;
  /** Convenience wrapper: FOUND order or undefined (conflates by design). */
  getOrder(pair: string, clientOrderId: string): Promise<BrokerOrder | undefined>;
  getOpenOrders(pair?: string): Promise<readonly BrokerOrder[]>;
  getPositions(pair?: string): Promise<readonly BrokerPosition[]>;
  getBalances(): Promise<readonly BrokerBalance[]>;
  setLeverage(pair: string, leverage: number): Promise<void>;
  attachTPSL(pair: string, positionId: string, sl?: number, tp?: number): Promise<void>;
  closePosition(pair: string): Promise<void>;
}
