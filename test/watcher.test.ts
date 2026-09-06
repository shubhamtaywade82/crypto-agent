import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@nemesis-oss/binance-sdk', async () => {
  const { EventEmitter } = await import('node:events');
  class MockSpotMarketWS extends EventEmitter {
    subscribe = vi.fn();
    close = vi.fn();
    miniTicker(symbol: string): string { return `${symbol.toLowerCase()}@miniTicker`; }
    trade(symbol: string): string { return `${symbol.toLowerCase()}@trade`; }
  }
  return { SpotMarketWS: MockSpotMarketWS };
});

describe('PriceWatcher', () => {
  let PriceWatcher: typeof import('../src/engine/watcher.js').PriceWatcher;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/engine/watcher.js');
    PriceWatcher = mod.PriceWatcher;
  });

  it('emits trigger when price crosses above target', async () => {
    const { EventEmitter } = await import('node:events');
    const watcher = new PriceWatcher();
    watcher.start();
    watcher.addWatch({
      id: 'sol-breakout',
      symbol: 'SOLUSDT',
      strategy: 'Breakout Buy',
      type: 'price_above',
      targetPrice: 106,
      cooldownMs: 0,
      createdAt: Date.now(),
      reEvaluationPrompt: 'Check SOLUSDT breakout',
    });

    const triggered = new Promise<{ currentPrice: number }>((resolve) => {
      watcher.on('trigger', resolve);
    });

    const ws = (watcher as unknown as { ws: InstanceType<typeof EventEmitter> }).ws;
    ws.emit('message', 'solusdt@miniTicker', { s: 'SOLUSDT', c: '106.50' });

    const event = await triggered;
    expect(event.currentPrice).toBe(106.5);
    watcher.stop();
  });

  it('does not trigger when price is below target for price_above', async () => {
    const { EventEmitter } = await import('node:events');
    const watcher = new PriceWatcher();
    const spy = vi.fn();
    watcher.start();
    watcher.on('trigger', spy);
    watcher.addWatch({
      id: 'btc-breakout',
      symbol: 'BTCUSDT',
      strategy: 'Breakout',
      type: 'price_above',
      targetPrice: 85000,
      cooldownMs: 0,
      createdAt: Date.now(),
      reEvaluationPrompt: 'check',
    });

    const ws = (watcher as unknown as { ws: InstanceType<typeof EventEmitter> }).ws;
    ws.emit('message', 'btcusdt@miniTicker', { s: 'BTCUSDT', c: '84000' });

    expect(spy).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('respects cooldown between triggers', async () => {
    const { EventEmitter } = await import('node:events');
    const watcher = new PriceWatcher();
    const spy = vi.fn();
    watcher.start();
    watcher.on('trigger', spy);
    watcher.addWatch({
      id: 'eth-test',
      symbol: 'ETHUSDT',
      strategy: 'Test',
      type: 'price_above',
      targetPrice: 3000,
      cooldownMs: 60_000,
      createdAt: Date.now(),
      reEvaluationPrompt: 'check',
    });

    const ws = (watcher as unknown as { ws: InstanceType<typeof EventEmitter> }).ws;
    ws.emit('message', 'ethusdt@miniTicker', { s: 'ETHUSDT', c: '3100' });
    ws.emit('message', 'ethusdt@miniTicker', { s: 'ETHUSDT', c: '3200' });

    // Only first trigger fires; second is within cooldown
    expect(spy).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('returns correct statuses and supports removeWatch', () => {
    const watcher = new PriceWatcher();
    watcher.start();
    watcher.addWatch({
      id: 'test-1',
      symbol: 'SOLUSDT',
      strategy: 'Test',
      type: 'price_below',
      targetPrice: 100,
      cooldownMs: 5000,
      createdAt: Date.now(),
      reEvaluationPrompt: 'check',
    });

    expect(watcher.getStatuses()).toHaveLength(1);
    expect(watcher.getStatuses()[0]?.symbol).toBe('SOLUSDT');

    watcher.removeWatch('test-1');
    expect(watcher.getStatuses()).toHaveLength(0);
    watcher.stop();
  });

  it('updates and returns currentPrice when tick arrives', async () => {
    const { EventEmitter } = await import('node:events');
    const watcher = new PriceWatcher();
    watcher.start();
    watcher.addWatch({
      id: 'test-tick',
      symbol: 'SOLUSDT',
      strategy: 'Test',
      type: 'price_above',
      targetPrice: 120,
      cooldownMs: 5000,
      createdAt: Date.now(),
      reEvaluationPrompt: 'check',
    });

    expect(watcher.getStatuses()[0]?.currentPrice).toBeUndefined();

    const ws = (watcher as unknown as { ws: InstanceType<typeof EventEmitter> }).ws;
    ws.emit('message', 'solusdt@miniTicker', { s: 'SOLUSDT', c: '108.25' });

    expect(watcher.getStatuses()[0]?.currentPrice).toBe(108.25);
    watcher.stop();
  });

  it('returns core market tickers and updates on live trade events', async () => {
    const { EventEmitter } = await import('node:events');
    const watcher = new PriceWatcher();
    watcher.start();

    const initial = watcher.getMarketTickers();
    expect(initial).toHaveLength(4);
    expect(initial.map((t) => t.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']);

    const ws = (watcher as unknown as { ws: InstanceType<typeof EventEmitter> }).ws;
    ws.emit('message', 'btcusdt@trade', { s: 'BTCUSDT', p: '80000' });
    ws.emit('message', 'xrpusdt@trade', { s: 'XRPUSDT', p: '1.45' });

    const updated = watcher.getMarketTickers();
    expect(updated.find((t) => t.symbol === 'BTCUSDT')?.price).toBe(80000);
    expect(updated.find((t) => t.symbol === 'XRPUSDT')?.price).toBe(1.45);
    watcher.stop();
  });
});

describe('Watch Tools', () => {
  it('registers watch with minimal params using smart defaults', async () => {
    const { createRegisterWatchTool } = await import('../src/engine/watch-tools.js');
    const mockOrchestrator = {
      addWatch: vi.fn(),
      removeWatch: vi.fn(),
      getStatuses: vi.fn().mockReturnValue([]),
    } as unknown as import('../src/engine/orchestrator.js').WatchOrchestrator;

    const tool = createRegisterWatchTool(mockOrchestrator);
    const res = (await tool.execute({ symbol: 'SOLUSDT', targetPrice: 110 }, {})) as {
      symbol: string;
      targetPrice: number;
      type: string;
      status: string;
    };

    expect(res.symbol).toBe('SOLUSDT');
    expect(res.targetPrice).toBe(110);
    expect(res.type).toBe('price_above');
    expect(res.status).toBe('watching');
    expect(mockOrchestrator.addWatch).toHaveBeenCalledOnce();
  });
});

