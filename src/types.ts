export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface TickerResult {
  readonly symbol: string;
  readonly price: string;
  readonly timestamp: number;
}

export interface PositionSizeParams {
  readonly accountBalance: string;
  readonly riskPercent: string;
  readonly entryPrice: string;
  readonly stopLossPrice: string;
}

export interface PositionSizeResult {
  readonly quantity: string;
  readonly riskAmount: string;
  readonly notional: string;
  readonly riskPerUnit: string;
}

export interface AccountBalanceResult {
  readonly asset: string;
  readonly totalBalance: string;
  readonly availableBalance: string;
  readonly timestamp: number;
}

export interface PlaceOrderParams {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: string;
  readonly orderType: OrderType;
  readonly price?: string | undefined;
}

export interface PlaceOrderResult {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: string;
  readonly status: 'FILLED' | 'NEW';
  readonly timestamp: number;
}
