import { describe, it, expect, vi } from 'vitest';
import { SymbolRouter } from '../src/infrastructure/coindcx/symbol-router.js';
import { futuresPair, parseFuturesPair, baseAssetOfBinanceSymbol } from '../src/infrastructure/coindcx/pair-mapper.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';

const makeClient = (pairs: string[], usdtInr?: number): CoinDCXClient => ({
  futures: {
    market: { getMarketsDetails: vi.fn().mockResolvedValue(pairs.map((p) => ({ pair: p }))) },
  },
  marketData: {
    getSpotTicker: vi.fn().mockResolvedValue(
      usdtInr !== undefined ? [{ pair: 'USDTINR', last_price: String(usdtInr) }] : []
    ),
  },
}) as unknown as CoinDCXClient;

describe('pair mapper', () => {
  it('builds and parses CoinDCX futures pairs', () => {
    expect(futuresPair('SOL', 'USDT')).toBe('B-SOL_USDT');
    expect(parseFuturesPair('B-SOL_USDT')).toEqual({ base: 'SOL', quote: 'USDT' });
    expect(parseFuturesPair('b-sol_inr')).toEqual({ base: 'SOL', quote: 'INR' });
    expect(parseFuturesPair('garbage')).toBeUndefined();
  });

  it('strips Binance quote assets', () => {
    expect(baseAssetOfBinanceSymbol('SOLUSDT')).toBe('SOL');
    expect(baseAssetOfBinanceSymbol('BTCUSDT')).toBe('BTC');
    expect(baseAssetOfBinanceSymbol('XRPINR')).toBe('XRP');
  });
});

describe('SymbolRouter — USDT preferred with INR auto-fallback', () => {
  it('prefers the USDT-margined pair with fxRate 1', async () => {
    const router = new SymbolRouter(
      makeClient(['B-SOL_USDT', 'B-SOL_INR'], 90), 'auto'
    );
    const r = await router.resolve('SOLUSDT');
    expect(r.pair).toBe('B-SOL_USDT');
    expect(r.fxRate).toBe(1);
  });

  it('falls back to INR with a live USDTINR rate', async () => {
    const router = new SymbolRouter(makeClient(['B-SOL_INR'], 90), 'auto');
    const r = await router.resolve('SOLUSDT');
    expect(r.pair).toBe('B-SOL_INR');
    expect(r.fxRate).toBe(90);
  });

  it('throws when neither market is listed', async () => {
    const router = new SymbolRouter(makeClient(['B-ADA_USDT']), 'auto');
    await expect(router.resolve('SOLUSDT')).rejects.toThrow(/no CoinDCX futures market/);
  });

  it('INR preference forces the INR pair when listed', async () => {
    const router = new SymbolRouter(
      makeClient(['B-SOL_USDT', 'B-SOL_INR'], 88), 'INR'
    );
    const r = await router.resolve('SOLUSDT');
    expect(r.pair).toBe('B-SOL_INR');
  });

  it('fails closed when FX rate is unavailable for an INR-only listing', async () => {
    const router = new SymbolRouter(makeClient(['B-SOL_INR']), 'auto');
    await expect(router.resolve('SOLUSDT')).rejects.toThrow(/USDTINR/);
  });

  it('caches instrument listings', async () => {
    const client = makeClient(['B-SOL_USDT']);
    const router = new SymbolRouter(client, 'auto');
    await router.resolve('SOLUSDT');
    await router.resolve('SOLUSDT');
    expect(client.futures.market.getMarketsDetails).toHaveBeenCalledTimes(1);
  });
});
