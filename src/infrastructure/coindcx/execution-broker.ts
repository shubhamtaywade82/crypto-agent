import {
  CoinDCXClient,
  type FuturesOrderResponse,
  type PositionResponse,
} from '@nemesis-oss/coindcx-sdk';
import type {
  BrokerBalance, BrokerOrder, BrokerPosition, IExecutionBroker, PlaceOrderRequest,
} from '../broker/broker.js';
import type { ContractSpec } from '../../domain/futures/contract-spec.js';
import { specFromInstrument, FALLBACK_SPEC } from '../../domain/futures/contract-spec.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';
import { baseAssetOfBinanceSymbol } from './pair-mapper.js';

export interface CoinDCXBrokerOptions {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly paperMode?: boolean;
  readonly initialFuturesBalance?: number;
  readonly maxOrderNotional?: number;
  readonly maxOrderQuantity?: number;
  /** Live USDT->INR rate source (wired to SymbolRouter). */
  readonly fxProvider?: () => Promise<number>;
}

const mapStatus = (raw: string): OrderStatus => {
  switch (raw) {
    case 'open': return 'SUBMITTED';
    case 'open_partially_filled': return 'PARTIALLY_FILLED';
    case 'filled': return 'FILLED';
    case 'cancelled': return 'CANCELLED';
    case 'rejected': return 'REJECTED';
    default: return 'ACKNOWLEDGED';
  }
};

const toBrokerOrder = (o: FuturesOrderResponse): BrokerOrder => ({
  orderId: String(o.id),
  clientOrderId: o.client_order_id ?? String(o.id),
  pair: o.pair,
  status: mapStatus(o.status),
  filledQuantity: o.filled_quantity ?? 0,
  avgFillPrice: o.price ?? undefined,
});

const toBrokerPosition = (p: PositionResponse): BrokerPosition => ({
  positionId: String(p.id),
  pair: p.pair,
  side: p.side,
  size: p.size,
  entryPrice: p.entry_price,
  markPrice: p.mark_price,
  unrealizedPnl: p.unrealized_pnl,
  leverage: p.leverage,
});

/**
 * CoinDCX futures execution adapter — the ONLY component in the system
 * that may create, cancel or close positions. Orders are idempotent via
 * client_order_id = kernel intentId (the SDK retries POSTs safely).
 * INR-margined routes convert USDT prices through a live FX rate.
 */
export class CoinDCXExecutionBroker implements IExecutionBroker {
  readonly id = 'coindcx';
  readonly capabilities = ['ORDER_EXECUTION', 'POSITIONS', 'ACCOUNT', 'PRIVATE_STREAMS'] as const;

  private readonly client: CoinDCXClient;
  private readonly fx?: () => Promise<number>;
  private readonly fxCache = new Map<string, number>();

  constructor(client: CoinDCXClient, opts: CoinDCXBrokerOptions = {}) {
    this.client = client;
    this.fx = opts.fxProvider;
    if (opts.maxOrderNotional !== undefined || opts.maxOrderQuantity !== undefined) {
      client.setSafetyLimits({
        ...(opts.maxOrderQuantity !== undefined ? { maxOrderQuantity: opts.maxOrderQuantity } : {}),
        ...(opts.maxOrderNotional !== undefined ? { maxOrderNotional: opts.maxOrderNotional } : {}),
      });
    }
  }

  private async fxRate(pair: string): Promise<number> {
    if (!pair.toUpperCase().endsWith('_INR')) return 1;
    const cached = this.fxCache.get(pair);
    if (cached) return cached;
    if (!this.fx) throw new Error(`INR pair ${pair} requires an fxProvider`);
    const rate = await this.fx();
    this.fxCache.set(pair, rate);
    return rate;
  }

  private async priceOut(pair: string, usdtPrice: number): Promise<number> {
    const rate = await this.fxRate(pair);
    return Number((usdtPrice * rate).toFixed(6));
  }

  async getInstrument(pair: string): Promise<ContractSpec | undefined> {
    try {
      const inst = await this.client.futures.market.getInstrumentDetails(pair);
      return specFromInstrument({ ...inst, pair });
    } catch {
      const base = baseAssetOfBinanceSymbol(pair.split('_')[0] ?? 'BASE');
      const quote = pair.includes('_INR') ? 'INR' : 'USDT';
      return FALLBACK_SPEC(base, quote);
    }
  }

  async setLeverage(pair: string, leverage: number): Promise<void> {
    await this.client.futures.account.updateLeverage({ pair, leverage });
  }

  async placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder> {
    const parts = req.pair.split('_');
    const base = (parts[0] ?? '').replace(/^[^-]-/, '');
    const quote = parts[1] ?? 'USDT';
    const price = req.price !== undefined
      ? await this.priceOut(req.pair, req.price)
      : undefined;
    const res = await this.client.futures.trading.createOrder({
      side: req.side,
      order_type: req.orderType,
      base_currency: base,
      quote_currency: quote,
      target_quantity: req.quantity,
      price,
      leverage: req.leverage,
      client_order_id: req.intentId,
      time_in_force: req.orderType === 'market_order' ? 'ioc' : 'gtc',
      stop_loss: req.stopLoss !== undefined ? await this.priceOut(req.pair, req.stopLoss) : undefined,
      take_profit: req.takeProfit !== undefined ? await this.priceOut(req.pair, req.takeProfit) : undefined,
      margin_type: req.marginType,
    });
    return toBrokerOrder(res);
  }

  async cancelOrder(_pair: string, orderId: string): Promise<void> {
    await this.client.futures.trading.cancelOrder({ id: orderId });
  }

  async getOrder(pair: string, clientOrderId: string): Promise<BrokerOrder | undefined> {
    const page = await this.client.futures.trading.listOrders({ pair, limit: 100 });
    const match = (page as readonly FuturesOrderResponse[])
      .find((o) => o.client_order_id === clientOrderId);
    return match ? toBrokerOrder(match) : undefined;
  }

  async getOpenOrders(pair?: string): Promise<readonly BrokerOrder[]> {
    const page = await this.client.futures.trading.listOrders({ pair, status: 'open', limit: 100 });
    return (page as readonly FuturesOrderResponse[]).map(toBrokerOrder);
  }

  async getPositions(pair?: string): Promise<readonly BrokerPosition[]> {
    const positions = await this.client.futures.account.getPositions(
      pair ? { pair, status: 'open' } : { status: 'open' }
    );
    return (positions as readonly PositionResponse[])
      .filter((p) => p.size > 0)
      .map(toBrokerPosition);
  }

  async getBalances(): Promise<readonly BrokerBalance[]> {
    const wallet = await this.client.futures.account.getWallet();
    return (wallet as readonly { currency: string; balance: number; available_balance: number }[])
      .map((w) => ({ currency: w.currency, total: w.balance, available: w.available_balance }));
  }

  async attachTPSL(pair: string, positionId: string, sl?: number, tp?: number): Promise<void> {
    await this.client.futures.account.createTPSL({
      position_id: positionId,
      stop_loss: sl !== undefined ? await this.priceOut(pair, sl) : undefined,
      take_profit: tp !== undefined ? await this.priceOut(pair, tp) : undefined,
    });
  }

  async closePosition(pair: string): Promise<void> {
    await this.client.futures.account.exitPosition({ pair });
  }
}
