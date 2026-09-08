import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { EventStore } from '../events/event-store.js';
import type { PortfolioStateStore } from '../../engines/portfolio-state-store.js';
import { createLogger, type Logger } from '../observability/logger.js';

/**
 * Supervises the CoinDCX private WS (order/position/balance streams) and
 * translates SDK events into neutral PortfolioStateStore updates. REST
 * stays the snapshot/recovery path: on every reconnect the full account
 * snapshot is re-synced via the broker before the cache is trusted again.
 */
export type AccountStreamState = 'IDLE' | 'CONNECTED' | 'DISCONNECTED';

export interface AccountStreamOptions {
  readonly client: CoinDCXClient;
  readonly store: PortfolioStateStore;
  readonly audit?: EventStore;
  /** REST recovery: re-seed the cache with a full broker snapshot. */
  readonly resync?: () => Promise<void>;
  readonly now?: () => number;
  readonly log?: Logger;
}

interface RawOrderUpdate {
  id?: string | number;
  client_order_id?: string;
  pair?: string;
  status?: string;
  filled_quantity?: number;
  timestamp?: number;
}

interface RawPositionUpdate {
  pair?: string;
  side?: string;
  size?: number;
  entry_price?: number;
  mark_price?: number;
  unrealized_pnl?: number;
  timestamp?: number;
}

interface RawBalanceUpdate {
  currency?: string;
  balance?: number;
  locked_balance?: number;
  timestamp?: number;
}

/**
 * Minimal structural view of the SDK WsClient. Its EventEmitter3 base
 * fails to type-resolve under NodeNext (SDK type-hygiene gap), so we bind
 * only the channels this adapter consumes — checked, explicit, and local.
 */
interface WsClientLike {
  on(event: 'open', handler: () => void): void;
  on(event: 'close', handler: (reason: string) => void): void;
  on(event: 'df-order-update', handler: (data: RawOrderUpdate) => void): void;
  on(event: 'df-position-update', handler: (data: RawPositionUpdate) => void): void;
  on(event: 'balance-update', handler: (data: RawBalanceUpdate) => void): void;
}

export class CoinDCXAccountStream {
  private readonly client: CoinDCXClient;
  private readonly store: PortfolioStateStore;
  private readonly audit?: EventStore;
  private readonly resync?: () => Promise<void>;
  private readonly now: () => number;
  private readonly log: Logger;
  private stateValue: AccountStreamState = 'IDLE';
  private attached = false;
  private lastEventAt?: number;

  constructor(opts: AccountStreamOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.audit = opts.audit;
    this.resync = opts.resync;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? createLogger('account-stream');
  }

  get state(): AccountStreamState {
    return this.stateValue;
  }

  status(): { readonly state: AccountStreamState; readonly lastEventAt?: number } {
    return { state: this.stateValue, lastEventAt: this.lastEventAt };
  }

  private setState(next: AccountStreamState): void {
    if (this.stateValue === next) return;
    this.stateValue = next;
    this.audit?.append({
      type: 'account.stream.state',
      payload: { venue: 'coindcx', state: next },
    });
  }

  /** Connect + subscribe private streams + attach listeners (idempotent). */
  async start(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
    this.client.connectWebsocket();
    this.client.subscribePrivateStreams();
    const ws = this.client.ws as unknown as WsClientLike;
    ws.on('open', (): void => void this.onOpen());
    ws.on('close', (): void => this.onClose());
    ws.on('df-order-update', (d: RawOrderUpdate): void => this.onOrder(d));
    ws.on('df-position-update', (d: RawPositionUpdate): void => this.onPosition(d));
    ws.on('balance-update', (d: RawBalanceUpdate): void => this.onBalance(d));
    this.setState('DISCONNECTED'); // socket requested, not yet open
  }

  /** Graceful shutdown: detach listeners and drop the socket. */
  stop(): void {
    if (!this.attached) return;
    this.attached = false;
    this.client.disconnect();
    this.setState('IDLE');
  }

  private async onOpen(): Promise<void> {
    // Resync on EVERY open: the cache is only trusted between socket drops,
    // so each (re)connect re-seeds it from a REST snapshot first.
    this.setState('CONNECTED');
    if (!this.resync) return;
    try {
      await this.resync();
    } catch (err) {
      this.log.warn('post-reconnect account resync failed', { err: String(err) });
    }
  }

  private onClose(): void {
    this.setState('DISCONNECTED');
  }

  private onOrder(d: RawOrderUpdate): void {
    if (d.id === undefined || d.status === undefined) return;
    const at = d.timestamp ?? this.now();
    this.store.applyOrder({
      id: String(d.id), clientOrderId: d.client_order_id, pair: d.pair,
      status: d.status, filledQuantity: d.filled_quantity, at,
    });
    this.lastEventAt = at;
  }

  private onPosition(d: RawPositionUpdate): void {
    if (!d.pair || d.size === undefined || d.entry_price === undefined) return;
    const side = d.side === 'short' ? 'short' : 'long';
    const at = d.timestamp ?? this.now();
    this.store.applyPosition({
      pair: d.pair, side, size: d.size, entryPrice: d.entry_price,
      markPrice: d.mark_price, unrealizedPnl: d.unrealized_pnl, at,
    });
    this.lastEventAt = at;
  }

  private onBalance(d: RawBalanceUpdate): void {
    if (!d.currency || d.balance === undefined) return;
    const at = d.timestamp ?? this.now();
    this.store.applyBalance({
      currency: d.currency, total: d.balance, locked: d.locked_balance, at,
    });
    this.lastEventAt = at;
  }
}
