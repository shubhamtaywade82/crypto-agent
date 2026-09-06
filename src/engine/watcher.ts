import { EventEmitter } from 'node:events';
import { SpotMarketWS } from '@nemesis-oss/binance-sdk';
import type { MarketTicker, WatchCondition, WatcherStatus, WatchTriggerEvent } from '../types.js';

export const CORE_MARKET_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] as const;

// Binance WS payload shape (supports real-time trade and miniTicker)
interface WsPriceData {
  readonly s: string;
  readonly p?: number | string;
  readonly c?: number | string;
}

/**
 * Event-driven WebSocket price watcher.
 * Subscribes to Binance miniTicker streams and evaluates user-defined
 * watch conditions on every tick. Emits 'trigger' when a condition matches.
 *
 * Events:
 *  - 'trigger'  (event: WatchTriggerEvent)
 *  - 'connected'
 *  - 'disconnected'
 *  - 'error'    (err: Error)
 */
export class PriceWatcher extends EventEmitter {
  private readonly ws: SpotMarketWS;
  private readonly conditions = new Map<string, WatchCondition>();
  private readonly lastTrigger = new Map<string, number>();
  private readonly subscribedSymbols = new Set<string>();
  private readonly latestPrices = new Map<string, number>();
  private connected = false;

  constructor(baseStreamUrl?: string) {
    super();
    this.ws = baseStreamUrl
      ? new SpotMarketWS(baseStreamUrl)
      : new SpotMarketWS();
  }

  start(): void {
    this.ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
    });
    this.ws.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });
    this.ws.on('error', (err: Error) => this.emit('error', err));
    this.ws.on('message', (_stream: string, data: unknown) => {
      this.handleTick(data as WsPriceData);
    });
    for (const sym of CORE_MARKET_SYMBOLS) this.subscribedSymbols.add(sym);
    this.ws.subscribe(CORE_MARKET_SYMBOLS.map((s) => this.ws.trade(s)));
  }

  addWatch(condition: WatchCondition): void {
    this.conditions.set(condition.id, condition);
    const sym = condition.symbol.toUpperCase();
    if (!this.subscribedSymbols.has(sym)) {
      this.subscribedSymbols.add(sym);
      this.ws.subscribe([this.ws.trade(sym)]);
    }
  }

  removeWatch(id: string): boolean {
    return this.conditions.delete(id);
  }

  getMarketTickers(): MarketTicker[] {
    return CORE_MARKET_SYMBOLS.map((sym) => ({
      symbol: sym,
      price: this.latestPrices.get(sym),
    }));
  }

  getStatuses(): WatcherStatus[] {
    return [...this.conditions.values()].map((c) => ({
      id: c.id,
      symbol: c.symbol,
      type: c.type,
      targetPrice: c.targetPrice,
      strategy: c.strategy,
      isConnected: this.connected,
      currentPrice: this.latestPrices.get(c.symbol.toUpperCase()),
    }));
  }

  stop(): void {
    this.ws.close();
    this.conditions.clear();
    this.subscribedSymbols.clear();
    this.latestPrices.clear();
    this.connected = false;
  }

  private handleTick(data: WsPriceData): void {
    if (!data?.s) return;
    const raw = data.p ?? data.c;
    if (raw === undefined) return;
    const price = typeof raw === 'number' ? raw : parseFloat(raw);
    if (Number.isNaN(price)) return;
    const sym = data.s.toUpperCase();
    this.latestPrices.set(sym, price);
    this.emit('tick', { symbol: sym, price });
    this.evaluateConditions(sym, price);
  }

  private evaluateConditions(symbol: string, price: number): void {
    const now = Date.now();
    for (const [id, cond] of this.conditions) {
      if (cond.symbol.toUpperCase() !== symbol) continue;
      const elapsed = now - (this.lastTrigger.get(id) ?? 0);
      if (elapsed < cond.cooldownMs) continue;

      const matched =
        (cond.type === 'price_above' && price >= cond.targetPrice) ||
        (cond.type === 'price_below' && price <= cond.targetPrice);

      if (matched) {
        this.lastTrigger.set(id, now);
        const event: WatchTriggerEvent = {
          condition: cond,
          currentPrice: price,
          triggeredAt: now,
        };
        this.emit('trigger', event);
      }
    }
  }
}
