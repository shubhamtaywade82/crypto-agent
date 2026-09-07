import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { Candle, Timeframe } from '../../domain/market/types.js';
import type { IMarketDataProvider } from '../broker/broker.js';

const FAPI_INTERVAL: Readonly<Record<Timeframe, '5m' | '15m' | '1h' | '4h'>> = {
  '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
};

const toCandle = (k: {
  openTime: number; open: number; high: number; low: number; close: number; volume: number;
}): Candle => ({
  openTime: k.openTime, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
});

/**
 * Binance public market-data provider. Deliberately implements ONLY the
 * read-only IMarketDataProvider surface — no order, position or account
 * capability exists here, so the compiler itself enforces the
 * "Binance = data only" architectural decision (see ADR-001).
 */
export class BinanceMarketDataProvider implements IMarketDataProvider {
  readonly id = 'binance';
  readonly capabilities = ['MARKET_DATA'] as const;

  constructor(private readonly client: BinanceClient) {}

  async getKlines(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const raw = await this.client.futures.market.klines(
      symbol, FAPI_INTERVAL[timeframe], { limit }
    );
    return raw.map(toCandle);
  }

  async getTickerPrice(symbol: string): Promise<number> {
    const t = await this.client.futures.market.tickerPrice(symbol);
    return Number(t.price);
  }

  async getMarkIndex(symbol: string): Promise<{ mark: number; index: number }> {
    const p = await this.client.futures.data.premiumIndex(symbol);
    return { mark: Number(p.markPrice), index: Number(p.indexPrice) };
  }

  async getFundingRate(symbol: string): Promise<number> {
    const p = await this.client.futures.data.premiumIndex(symbol);
    return Number(p.lastFundingRate);
  }

  async getOpenInterest(symbol: string): Promise<{ oi: number; changePct: number }> {
    const [current, hist] = await Promise.all([
      this.client.futures.data.openInterest(symbol),
      this.client.futures.data.openInterestHist(symbol, '1h', 2),
    ]);
    const oi = Number(current.openInterest);
    const prev = hist.length > 0 ? Number(hist[0]!.sumOpenInterest) : oi;
    const changePct = prev > 0 ? ((oi - prev) / prev) * 100 : 0;
    return { oi, changePct: Number(changePct.toFixed(3)) };
  }
}
