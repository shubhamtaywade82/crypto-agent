import type {
  BrokerBalance, BrokerLookupResult, BrokerOrder, BrokerPosition, IExecutionBroker, PlaceOrderRequest,
} from '../broker/broker.js';
import type { ContractSpec } from '../../domain/futures/contract-spec.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';
import { makeId } from '../../domain/primitives.js';

interface PaperState {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly pair: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: number;
  readonly limitPrice?: number;
  status: OrderStatus;
  filledQuantity: number;
}

interface PaperPositionState {
  readonly positionId: string;
  readonly pair: string;
  readonly side: 'long' | 'short';
  size: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  markPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Order lineage — lets closes be attributed to the originating decision. */
  decisionId?: string;
  strategyId?: string;
}

export interface PaperBrokerConfig {
  readonly initialBalance: number;
  readonly takerFeeRate?: number;
  readonly slippageRate?: number;
  readonly spec?: ContractSpec;
  /** Observed on every realized position close (drives PerformanceEngine). */
  readonly onClose?: (close: {
    readonly pair: string;
    readonly pnl: number;
    readonly at: number;
    readonly decisionId?: string;
    readonly strategyId?: string;
  }) => void;
}

const nextId = (): string => makeId('paper');

/**
 * Deterministic in-memory futures simulator. Models market/limit orders,
 * taker fees, slippage, leverage margin, positions and TP/SL triggers —
 * enough fidelity to validate the kernel without real money.
 */
export class PaperExecutionBroker implements IExecutionBroker {
  readonly id = 'paper';
  readonly capabilities = ['ORDER_EXECUTION', 'POSITIONS', 'ACCOUNT'] as const;

  private readonly orders = new Map<string, PaperState>();
  private readonly positions = new Map<string, PaperPositionState>();
  private readonly marks = new Map<string, number>();
  private balance: number;
  private readonly takerFee: number;
  private readonly slippage: number;
  private readonly spec?: ContractSpec;
  private readonly onClose?: PaperBrokerConfig['onClose'];
  /** Realized PnL ledger — the source for portfolio performance metrics. */
  readonly realizedCloses: {
    readonly pair: string; readonly pnl: number; readonly at: number;
    readonly decisionId?: string; readonly strategyId?: string;
  }[] = [];

  constructor(cfg: PaperBrokerConfig) {
    this.balance = cfg.initialBalance;
    this.takerFee = cfg.takerFeeRate ?? 0.0005;
    this.slippage = cfg.slippageRate ?? 0.0005;
    this.spec = cfg.spec;
    this.onClose = cfg.onClose;
  }

  async getInstrument(): Promise<ContractSpec | undefined> {
    return this.spec;
  }

  async getBalances(): Promise<readonly BrokerBalance[]> {
    const used = [...this.positions.values()]
      .reduce((acc, p) => acc + p.margin, 0);
    return [{ currency: 'USDT', total: this.balance, available: Math.max(0, this.balance - used) }];
  }

  async setLeverage(): Promise<void> { /* per-order leverage only */ }

  async placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder> {
    const mark = this.markFor(req.pair);
    const fillPrice = this.applySlippage(mark, req.side);
    const state: PaperState = {
      orderId: nextId(),
      clientOrderId: req.intentId,
      pair: req.pair,
      side: req.side,
      quantity: req.quantity,
      limitPrice: req.price,
      status: 'SUBMITTED',
      filledQuantity: 0,
    };
    this.orders.set(state.clientOrderId, state);

    if (req.orderType === 'limit_order' && req.price !== undefined &&
      !this.crosses(req.side, mark, req.price)) {
      return this.view(state);
    }
    return this.fill(state, req, fillPrice);
  }

  /** Execution-quality contract: reject fills beyond tolerated deviation. */
  private slippageBreached(req: PlaceOrderRequest, price: number): boolean {
    if (req.expectedPrice === undefined || req.maxSlippageBps === undefined ||
      req.maxSlippageBps <= 0) return false;
    const bps = req.maxSlippageBps / 10_000;
    const worst = req.side === 'buy'
      ? req.expectedPrice * (1 + bps)
      : req.expectedPrice * (1 - bps);
    return req.side === 'buy' ? price > worst : price < worst;
  }

  private fill(state: PaperState, req: PlaceOrderRequest, price: number): BrokerOrder {
    if (this.slippageBreached(req, price)) {
      state.status = 'REJECTED';
      return this.view(state);
    }
    const notional = price * state.quantity;
    const fee = notional * this.takerFee;
    const margin = notional / Math.max(1, req.leverage);
    if (margin + fee > this.available()) {
      state.status = 'REJECTED';
      return this.view(state);
    }
    if (!req.reduceOnly) {
      const side = req.side === 'buy' ? 'long' : 'short';
      const existing = this.positions.get(`${state.pair}:${side}`);
      if (existing) {
        existing.size += state.quantity;
        existing.entryPrice = (existing.entryPrice * existing.size + price * state.quantity) /
          (existing.size + state.quantity);
      } else {
        this.positions.set(`${state.pair}:${side}`, {
          positionId: nextId(), pair: state.pair, side, size: state.quantity,
          entryPrice: price, leverage: req.leverage, margin,
          markPrice: price, stopLoss: req.stopLoss, takeProfit: req.takeProfit,
          decisionId: req.decisionId, strategyId: req.strategyId,
        });
      }
    } else {
      this.reduce(state.pair, req.side === 'buy' ? 'short' : 'long', state.quantity, price);
    }
    this.balance -= fee;
    state.status = 'FILLED';
    state.filledQuantity = state.quantity;
    return this.view(state, price);
  }

  private reduce(pair: string, side: 'long' | 'short', qty: number, price: number): void {
    const pos = this.positions.get(`${pair}:${side}`);
    if (!pos) return;
    const pnl = side === 'long' ? (price - pos.entryPrice) * qty : (pos.entryPrice - price) * qty;
    const closing = Math.min(qty, pos.size);
    this.balance += pnl;
    pos.size -= closing;
    const close = {
      pair, pnl, at: Date.now(),
      decisionId: pos.decisionId, strategyId: pos.strategyId,
    };
    this.realizedCloses.push(close);
    this.onClose?.(close);
    if (pos.size <= 1e-12) this.positions.delete(`${pair}:${side}`);
  }

  /** Simulate protective order triggers at the given mark price. */
  checkProtectiveFills(pair: string, price: number): void {
    for (const [key, pos] of this.positions) {
      if (pos.pair !== pair) continue;
      if (pos.stopLoss !== undefined &&
        (pos.side === 'long' ? price <= pos.stopLoss : price >= pos.stopLoss)) {
        this.reduce(pair, pos.side, pos.size, pos.stopLoss);
        this.positions.delete(key);
      } else if (pos.takeProfit !== undefined &&
        (pos.side === 'long' ? price >= pos.takeProfit : price <= pos.takeProfit)) {
        this.reduce(pair, pos.side, pos.size, pos.takeProfit);
        this.positions.delete(key);
      }
    }
  }

  async cancelOrder(_pair: string, orderId: string): Promise<void> {
    const state = [...this.orders.values()].find((o) => o.orderId === orderId);
    if (state && state.status === 'SUBMITTED') state.status = 'CANCELLED';
  }

  /**
   * Three-state lookup against the in-memory order book. The simulator
   * is local and deterministic, so lookups cannot fail: an unknown
   * client_order_id is a genuine NOT_FOUND.
   */
  async lookupOrder(pair: string, clientOrderId: string): Promise<BrokerLookupResult> {
    const state = this.orders.get(clientOrderId);
    if (!state || state.pair !== pair) return { kind: 'NOT_FOUND' };
    return { kind: 'FOUND', order: this.view(state) };
  }

  async getOrder(pair: string, clientOrderId: string): Promise<BrokerOrder | undefined> {
    const result = await this.lookupOrder(pair, clientOrderId);
    return result.kind === 'FOUND' ? result.order : undefined;
  }

  async getOpenOrders(pair?: string): Promise<readonly BrokerOrder[]> {
    return [...this.orders.values()]
      .filter((o) => o.status === 'SUBMITTED' && (!pair || o.pair === pair))
      .map((o) => this.view(o));
  }

  async getPositions(pair?: string): Promise<readonly BrokerPosition[]> {
    return [...this.positions.values()]
      .filter((p) => !pair || p.pair === pair)
      .map((p) => ({
        positionId: p.positionId, pair: p.pair, side: p.side, size: p.size,
        entryPrice: p.entryPrice, markPrice: p.markPrice,
        unrealizedPnl: p.side === 'long'
          ? (p.markPrice - p.entryPrice) * p.size
          : (p.entryPrice - p.markPrice) * p.size,
        leverage: p.leverage,
      }));
  }

  async attachTPSL(pair: string, positionId: string, sl?: number, tp?: number): Promise<void> {
    for (const pos of this.positions.values()) {
      if (pos.pair === pair && pos.positionId === positionId) {
        if (sl !== undefined) pos.stopLoss = sl;
        if (tp !== undefined) pos.takeProfit = tp;
      }
    }
  }

  async closePosition(pair: string): Promise<void> {
    for (const [key, pos] of this.positions) {
      if (pos.pair === pair) {
        this.reduce(pair, pos.side, pos.size, pos.markPrice);
        this.positions.delete(key);
      }
    }
  }

  setMarkPrice(pair: string, price: number): void {
    this.marks.set(pair, price);
    for (const pos of this.positions.values()) {
      if (pos.pair === pair) pos.markPrice = price;
    }
  }

  private available(): number {
    const used = [...this.positions.values()].reduce((acc, p) => acc + p.margin, 0);
    return Math.max(0, this.balance - used);
  }

  private markFor(pair: string): number {
    const stored = this.marks.get(pair);
    if (stored !== undefined) return stored;
    for (const pos of this.positions.values()) {
      if (pos.pair === pair) return pos.markPrice;
    }
    return Number(process.env.PAPER_FALLBACK_MARK_PRICE ?? 100);
  }

  private applySlippage(mark: number, side: 'buy' | 'sell'): number {
    const factor = side === 'buy' ? 1 + this.slippage : 1 - this.slippage;
    return Number((mark * factor).toFixed(8));
  }

  private crosses(side: 'buy' | 'sell', mark: number, limit: number): boolean {
    return side === 'buy' ? limit >= mark : limit <= mark;
  }

  private view(state: PaperState, fillPrice?: number): BrokerOrder {
    return {
      orderId: state.orderId, clientOrderId: state.clientOrderId, pair: state.pair,
      status: state.status, filledQuantity: state.filledQuantity,
      avgFillPrice: fillPrice ?? state.limitPrice,
    };
  }
}
