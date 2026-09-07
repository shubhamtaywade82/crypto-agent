import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import { baseAssetOfBinanceSymbol, futuresPair } from './pair-mapper.js';

export interface ResolvedPair {
  readonly binanceSymbol: string;
  readonly base: string;
  readonly pair: string;
  readonly quote: 'USDT' | 'INR';
  /** Multiply a Binance USDT price by this to get the venue price. */
  readonly fxRate: number;
}

interface InstrumentLite {
  readonly pair: string;
  readonly status?: string;
}

const CACHE_TTL_MS = 5 * 60_000;

/**
 * Routes a Binance market-data symbol to the best available CoinDCX
 * futures pair. Preference: USDT-margined (1:1 price parity with Binance
 * data) with automatic INR fallback when USDT is not listed; INR routes
 * carry a live USDT->INR FX rate so kernel math stays USDT-denominated.
 */
export class SymbolRouter {
  private cache?: { at: number; usdt: Set<string>; inr: Set<string> };
  private fx?: { at: number; rate: number };

  constructor(
    private readonly client: CoinDCXClient,
    private readonly quotePreference: 'USDT' | 'INR' | 'auto' = 'auto'
  ) {}

  async resolve(binanceSymbol: string): Promise<ResolvedPair> {
    const base = baseAssetOfBinanceSymbol(binanceSymbol);
    const { usdt, inr } = await this.instruments();
    const usdtPair = futuresPair(base, 'USDT');
    const inrPair = futuresPair(base, 'INR');

    const preferInr = this.quotePreference === 'INR';
    if (!preferInr && usdt.has(usdtPair)) {
      return { binanceSymbol, base, pair: usdtPair, quote: 'USDT', fxRate: 1 };
    }
    if (inr.has(inrPair) || preferInr) {
      if (inr.has(inrPair)) {
        return { binanceSymbol, base, pair: inrPair, quote: 'INR', fxRate: await this.usdtInr() };
      }
    }
    throw new Error(
      `no CoinDCX futures market for ${binanceSymbol} (tried ${usdtPair}, ${inrPair})`
    );
  }

  async isListed(binanceSymbol: string): Promise<boolean> {
    try {
      await this.resolve(binanceSymbol);
      return true;
    } catch {
      return false;
    }
  }

  private async instruments(): Promise<{ usdt: Set<string>; inr: Set<string> }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return { usdt: this.cache.usdt, inr: this.cache.inr };
    }
    const details = await this.client.futures.market.getMarketsDetails();
    const usdt = new Set<string>();
    const inr = new Set<string>();
    for (const d of details as readonly InstrumentLite[]) {
      const pair = String(d.pair ?? '').toUpperCase();
      if (pair.endsWith('_USDT')) usdt.add(pair);
      else if (pair.endsWith('_INR')) inr.add(pair);
    }
    this.cache = { at: Date.now(), usdt, inr };
    return { usdt, inr };
  }

  /** USDT/INR spot rate from CoinDCX public tickers (cached 5 min). */
  async usdtInr(): Promise<number> {
    if (this.fx && Date.now() - this.fx.at < CACHE_TTL_MS) return this.fx.rate;
    const tickers = await this.client.marketData.getSpotTicker();
    const usdtInr = (tickers as readonly { pair?: string; last_price?: string | number }[])
      .find((t) => String(t.pair ?? '').toUpperCase() === 'USDTINR' ||
        String(t.pair ?? '').toUpperCase() === 'T-USDT_INR');
    const rate = usdtInr ? Number(usdtInr.last_price) : Number.NaN;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('USDTINR rate unavailable; cannot price INR-margined route');
    }
    this.fx = { at: Date.now(), rate };
    return rate;
  }
}
