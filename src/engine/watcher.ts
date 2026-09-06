import { EventEmitter } from 'node:events';
import { SpotMarketWS } from '@nemesis-oss/binance-sdk';
import type { WatchCondition, WatcherStatus, WatchTriggerEvent } from '../types.js';

// Binance miniTicker payload shape (public, no auth required)
interface MiniTickerData {
  readonly s: string;  // symbol
  readonly c: string;  // close price
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
      this.handleTick(data as MiniTickerData);
    });
  }

  addWatch(condition: WatchCondition): void {
    this.conditions.set(condition.id, condition);
    const sym = condition.symbol.toUpperCase();
    if (!this.subscribedSymbols.has(sym)) {
      this.subscribedSymbols.add(sym);
      this.ws.subscribe([this.ws.miniTicker(sym)]);
    }
  }

  removeWatch(id: string): boolean {
    return this.conditions.delete(id);
  }

  getStatuses(): WatcherStatus[] {
    return [...this.conditions.values()].map((c) => ({
      id: c.id,
      symbol: c.symbol,
      type: c.type,
      targetPrice: c.targetPrice,
      strategy: c.strategy,
      isConnected: this.connected,
    }));
  }

  stop(): void {
    this.ws.close();
    this.conditions.clear();
    this.subscribedSymbols.clear();
    this.connected = false;
  }

  private handleTick(data: MiniTickerData): void {
    if (!data?.s || !data?.c) return;
    const price = parseFloat(data.c);
    if (Number.isNaN(price)) return;
    this.evaluateConditions(data.s.toUpperCase(), price);
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
