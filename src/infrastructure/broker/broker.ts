import type { Candle, Timeframe } from '../../domain/market/types.js';
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
}

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
}

/** Order/position/account execution (CoinDCX in this system). */
export interface IExecutionBroker {
  readonly id: string;
  readonly capabilities: readonly BrokerCapability[];
  getInstrument(pair: string): Promise<ContractSpec | undefined>;
  placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder>;
  cancelOrder(pair: string, orderId: string): Promise<void>;
  getOrder(pair: string, clientOrderId: string): Promise<BrokerOrder | undefined>;
  getOpenOrders(pair?: string): Promise<readonly BrokerOrder[]>;
  getPositions(pair?: string): Promise<readonly BrokerPosition[]>;
  getBalances(): Promise<readonly BrokerBalance[]>;
  setLeverage(pair: string, leverage: number): Promise<void>;
  attachTPSL(pair: string, positionId: string, sl?: number, tp?: number): Promise<void>;
  closePosition(pair: string): Promise<void>;
}
