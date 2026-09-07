import {
  CoinDCXClient,
  type FuturesOrderResponse,
  type PositionResponse,
} from '@nemesis-oss/coindcx-sdk';
import type {
  BrokerBalance, BrokerLookupResult, BrokerOrder, BrokerPosition, IExecutionBroker, PlaceOrderRequest,
} from '../broker/broker.js';
import type { ContractSpec } from '../../domain/futures/contract-spec.js';
import { specFromInstrument } from '../../domain/futures/contract-spec.js';
import { FxRateCache } from '../../domain/portfolio/valuation.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';

export interface CoinDCXBrokerOptions {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly paperMode?: boolean;
  readonly initialFuturesBalance?: number;
  readonly maxOrderNotional?: number;
  readonly maxOrderQuantity?: number;
  /** Live USDT->INR rate source (wired to SymbolRouter). */
  readonly fxProvider?: () => Promise<number>;
  /** FX freshness window overrides (defaults: fresh 30s, stale 120s). */
  readonly fxFreshMs?: number;
  readonly fxStaleMs?: number;
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
 * INR-margined routes convert USDT prices through a live, TTL-bounded
 * FX rate (fresh < 30s, stale-usable < 120s, otherwise refuse to price).
 */
export class CoinDCXExecutionBroker implements IExecutionBroker {
  readonly id = 'coindcx';
  readonly capabilities = ['ORDER_EXECUTION', 'POSITIONS', 'ACCOUNT', 'PRIVATE_STREAMS'] as const;

  private readonly client: CoinDCXClient;
  private readonly fx?: () => Promise<number>;
  /** USDT/INR rate cache with explicit freshness policy (never forever-cached). */
  private readonly fxCache: FxRateCache;

  constructor(client: CoinDCXClient, opts: CoinDCXBrokerOptions = {}) {
    this.client = client;
    this.fx = opts.fxProvider;
    this.fxCache = new FxRateCache({
      freshMs: opts.fxFreshMs,
      staleMs: opts.fxStaleMs,
    });
    if (opts.maxOrderNotional !== undefined || opts.maxOrderQuantity !== undefined) {
      client.setSafetyLimits({
        ...(opts.maxOrderQuantity !== undefined ? { maxOrderQuantity: opts.maxOrderQuantity } : {}),
        ...(opts.maxOrderNotional !== undefined ? { maxOrderNotional: opts.maxOrderNotional } : {}),
      });
    }
  }

  private async fxRate(pair: string): Promise<number> {
    if (!pair.toUpperCase().endsWith('_INR')) return 1;
    if (!this.fx) throw new Error(`INR pair ${pair} requires an fxProvider`);
    // FRESH/REFRESHED/STALE are all priceable; UNAVAILABLE throws so the
    // order fails safely instead of executing on a dead exchange rate.
    const quote = await this.fxCache.quote(this.fx);
    return quote.rate;
  }

  async convertPrice(pair: string, usdtPrice: number): Promise<number> {
    const rate = await this.fxRate(pair);
    return Number((usdtPrice * rate).toFixed(6));
  }

  /**
   * Instrument metadata. NOTE: failures propagate to the caller — the
   * ContractRegistry classifies them. A network/auth/rate-limit error
   * must NEVER degrade into a synthetic fallback spec here: fallback
   * specs are only safe for "known missing metadata", never for
   * "unknown exchange state".
   */
  async getInstrument(pair: string): Promise<ContractSpec | undefined> {
    const inst = await this.client.futures.market.getInstrumentDetails(pair);
    return inst ? specFromInstrument({ ...inst, pair }) : undefined;
  }

  async setLeverage(pair: string, leverage: number): Promise<void> {
    await this.client.futures.account.updateLeverage({ pair, leverage });
  }

  async placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder> {
    const parts = req.pair.split('_');
    const base = (parts[0] ?? '').replace(/^[^-]-/, '');
    const quote = parts[1] ?? 'USDT';

    // Execution-quality guard: a market order carrying an execution
    // contract (expectedPrice + maxSlippageBps) becomes a marketable
    // IOC limit at the worst tolerated price. The venue can then never
    // fill us at an unexpectedly adverse price.
    let orderType = req.orderType;
    let price = req.price !== undefined ? await this.convertPrice(req.pair, req.price) : undefined;
    let timeInForce: 'gtc' | 'ioc' | 'fok' =
      req.timeInForce ?? (req.orderType === 'market_order' ? 'ioc' : 'gtc');
    if (req.orderType === 'market_order' &&
      req.expectedPrice !== undefined && req.maxSlippageBps !== undefined &&
      req.maxSlippageBps > 0) {
      const bps = req.maxSlippageBps / 10_000;
      const worstUsdt = req.side === 'buy'
        ? req.expectedPrice * (1 + bps)
        : req.expectedPrice * (1 - bps);
      orderType = 'limit_order';
      price = await this.convertPrice(req.pair, worstUsdt);
      timeInForce = 'ioc';
    }

    const res = await this.client.futures.trading.createOrder({
      side: req.side,
      order_type: orderType,
      base_currency: base,
      quote_currency: quote,
      target_quantity: req.quantity,
      price,
      leverage: req.leverage,
      client_order_id: req.intentId,
      time_in_force: timeInForce,
      stop_loss: req.stopLoss !== undefined ? await this.convertPrice(req.pair, req.stopLoss) : undefined,
      take_profit: req.takeProfit !== undefined ? await this.convertPrice(req.pair, req.takeProfit) : undefined,
      margin_type: req.marginType,
    });
    return toBrokerOrder(res);
  }

  async cancelOrder(_pair: string, orderId: string): Promise<void> {
    await this.client.futures.trading.cancelOrder({ id: orderId });
  }

  /**
   * Three-state truth lookup: targeted recent-orders sweep, then the
   * open-order book. Network/auth/rate-limit failures return
   * LOOKUP_FAILED — they are NEVER reported as NOT_FOUND.
   */
  async lookupOrder(pair: string, clientOrderId: string): Promise<BrokerLookupResult> {
    try {
      const recent = await this.client.futures.trading.listOrders({ pair, limit: 100 });
      const match = (recent as readonly FuturesOrderResponse[])
        .find((o) => o.client_order_id === clientOrderId);
      if (match) return { kind: 'FOUND', order: toBrokerOrder(match) };

      const open = await this.client.futures.trading.listOrders({ pair, status: 'open', limit: 100 });
      const openMatch = (open as readonly FuturesOrderResponse[])
        .find((o) => o.client_order_id === clientOrderId);
      if (openMatch) return { kind: 'FOUND', order: toBrokerOrder(openMatch) };

      return { kind: 'NOT_FOUND' };
    } catch (err) {
      return {
        kind: 'LOOKUP_FAILED',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getOrder(pair: string, clientOrderId: string): Promise<BrokerOrder | undefined> {
    const result = await this.lookupOrder(pair, clientOrderId);
    return result.kind === 'FOUND' ? result.order : undefined;
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
      stop_loss: sl !== undefined ? await this.convertPrice(pair, sl) : undefined,
      take_profit: tp !== undefined ? await this.convertPrice(pair, tp) : undefined,
    });
  }

  async closePosition(pair: string): Promise<void> {
    await this.client.futures.account.exitPosition({ pair });
  }
}
