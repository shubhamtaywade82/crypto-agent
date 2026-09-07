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

export type AgentEvent =
  | { readonly type: 'token'; readonly content: string }
  | { readonly type: 'tool_call'; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly name: string; readonly result: unknown }
  | { readonly type: 'metrics'; readonly turn: number; readonly latencyMs: number; readonly isFinal: boolean }
  | { readonly type: 'done' };

export type WatchConditionType = 'price_above' | 'price_below';

export interface WatchCondition {
  readonly id: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly type: WatchConditionType;
  readonly targetPrice: number;
  readonly cooldownMs: number;
  readonly createdAt: number;
  readonly reEvaluationPrompt: string;
}

export interface WatchTriggerEvent {
  readonly condition: WatchCondition;
  readonly currentPrice: number;
  readonly triggeredAt: number;
}

export interface WatcherStatus {
  readonly id: string;
  readonly symbol: string;
  readonly type: WatchConditionType;
  readonly targetPrice: number;
  readonly strategy: string;
  readonly isConnected: boolean;
  readonly currentPrice?: number | undefined;
}

export interface MarketTicker {
  readonly symbol: string;
  readonly price?: number | undefined;
}

export type TradeStatus = 'PENDING' | 'OPEN' | 'CLOSED';
export type TradeOutcome = 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED';

export interface TradeRecord {
  readonly id: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly thesis: string;
  readonly status: TradeStatus;
  readonly createdAt: number;
  readonly openedAt?: number | undefined;
  readonly closedAt?: number | undefined;
  readonly exitPrice?: number | undefined;
  readonly outcome?: TradeOutcome | undefined;
  readonly pnlPercent?: number | undefined;
  readonly rMultiple?: number | undefined;
  readonly postMortem?: string | undefined;
  readonly lessonLearned?: string | undefined;
}

export interface LearnedLesson {
  readonly id: string;
  readonly symbol: string;
  readonly lesson: string;
  readonly context: string;
  readonly timestamp: number;
}
