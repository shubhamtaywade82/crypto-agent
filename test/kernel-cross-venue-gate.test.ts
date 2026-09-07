import { describe, it, expect } from 'vitest';
import { CrossVenueGate, type CrossVenueGateConfig } from '../src/infrastructure/coindcx/cross-venue-gate.js';
import { buildCrossVenueState, crossVenueExecutionRisk } from '../src/domain/market/cross-venue.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { SymbolRouter } from '../src/infrastructure/coindcx/symbol-router.js';

const book = (bid: number, ask: number): { bids: Record<string, string>; asks: Record<string, string> } => ({
  bids: { [bid.toString()]: '1.0' },
  asks: { [ask.toString()]: '1.0' },
});

const makeGate = (
  orderBook: Promise<{ bids: Record<string, string>; asks: Record<string, string> }>,
  binanceLast: number,
  pair = 'BTC_USDT',
  fxRate = 1,
  cfg: CrossVenueGateConfig = {}
): CrossVenueGate =>
  new CrossVenueGate(
    {
      client: {
        futures: { market: { getOrderBook: (_pair: string) => orderBook } },
      } as unknown as CoinDCXClient,
      router: {
        resolve: async () => ({
          binanceSymbol: 'BTCUSDT', base: 'BTC', pair,
          quote: fxRate === 1 ? ('USDT' as const) : ('INR' as const), fxRate,
        }),
      } as unknown as SymbolRouter,
      binanceTicker: async () => binanceLast,
    },
    cfg
  );

describe('CrossVenueGate — live basis/spread/health evaluation', () => {
  it('reports tradable when venues agree within tolerance', async () => {
    // Binance 100, CoinDCX USDT book 100.01/100.03 -> basis ~2bps, spread 2bps
    const gate = makeGate(Promise.resolve(book(100.01, 100.03)), 100);
    const verdict = await gate.evaluate('BTCUSDT');
    expect(verdict.tradable).toBe(true);
    expect(verdict.reasons).toHaveLength(0);
    expect(verdict.state?.basisBps).toBeCloseTo(2, 0);
  });

  it('rejects when the CoinDCX book trades far from Binance (basis)', async () => {
    const gate = makeGate(Promise.resolve(book(101.5, 101.6)), 100, 'BTC_USDT', 1, { maxBasisBps: 50 });
    const verdict = await gate.evaluate('BTCUSDT');
    expect(verdict.tradable).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('basis');
  });

  it('rejects when the execution venue spread is too wide', async () => {
    // 30bp spread on CoinDCX: 99.85/100.15 around Binance 100
    const gate = makeGate(Promise.resolve(book(99.85, 100.15)), 100, 'BTC_USDT', 1, { maxSpreadBps: 30 });
    const verdict = await gate.evaluate('BTCUSDT');
    expect(verdict.tradable).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('spread');
  });

  it('normalizes INR pairs through the routed FX rate before comparing', async () => {
    // Binance 100 USDT; CoinDCX INR book ~ 100 * 88 with small skew
    const gate = makeGate(Promise.resolve(book(8801, 8803)), 100, 'BTC_INR', 88);
    const verdict = await gate.evaluate('BTCUSDT');
    expect(verdict.tradable).toBe(true);
    expect(verdict.state?.fxRate).toBe(88);
  });

  it('fails safe: any snapshot-building failure reports NOT tradable', async () => {
    const gate = new CrossVenueGate({
      client: {
        futures: {
          market: {
            getOrderBook: async () => {
              throw new Error('rate limited');
            },
          },
        },
      } as unknown as CoinDCXClient,
      router: {
        resolve: async () => ({
          binanceSymbol: 'BTCUSDT', base: 'BTC', pair: 'BTC_USDT',
          quote: 'USDT' as const, fxRate: 1,
        }),
      } as unknown as SymbolRouter,
      binanceTicker: async () => 100,
    });
    const verdict = await gate.evaluate('BTCUSDT');
    expect(verdict.tradable).toBe(false);
    expect(verdict.reasons[0]).toContain('rate limited');
  });
});

describe('CrossVenueState — domain math sanity (wiring contract)', () => {
  it('buildCrossVenueState computes basis and staleness health', () => {
    const now = Date.now();
    const state = buildCrossVenueState(
      { venue: 'BINANCE', bid: 99.9, ask: 100.1, last: 100, at: now },
      { venue: 'COINDCX', bid: 100.5, ask: 100.7, last: 100.6, at: now },
      1,
      now
    );
    expect(state.basisBps).toBeCloseTo(60, 0);
    expect(state.health).toBe('OK');
    const risk = crossVenueExecutionRisk(state, 50, 30);
    expect(risk.tradable).toBe(false); // 60bps beyond the 50bps tolerance
  });
});
