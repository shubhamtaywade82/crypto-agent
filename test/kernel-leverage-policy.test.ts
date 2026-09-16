import { describe, it, expect } from 'vitest';
import { resolveLeverage, MIN_LEVERAGE, MAX_LEVERAGE } from '../src/engines/leverage-policy.js';
import type { MarketState } from '../src/domain/market/types.js';
import type { CircuitState } from '../src/domain/risk/risk-config.js';

const tfState = (trend: 'BULLISH' | 'BEARISH' | 'RANGE', volRegime: 'NORMAL' | 'HIGH_VOLATILITY' = 'NORMAL') => ({
  timeframe: '1h' as const,
  candles: 100,
  lastClose: 100,
  structure: { trend, bos: false, choch: false, swingHigh: 105, swingLow: 95, lastSwing: 'NONE' as const },
  momentum: { rsi: 50, rsiPrev: 50, macd: 0, macdSignal: 0, macdHist: 0, ema50: 100, ema200: 100 },
  volatility: { atr: 1, atrPercent: 1, atrPercentile: 50, regime: volRegime },
});

const makeState = (
  regime: MarketState['regime'],
  btcRegime: MarketState['regime'] = 'RANGE',
  volRegime: 'NORMAL' | 'HIGH_VOLATILITY' = 'NORMAL',
  microstructure?: MarketState['microstructure']
): MarketState => ({
  symbol: 'BTCUSDT',
  capturedAt: Date.now(),
  price: { last: 100, mark: 100, index: 100 },
  regime,
  btcRegime,
  timeframes: {
    '5m': tfState('BULLISH'),
    '15m': tfState('BULLISH', volRegime),
    '1h': tfState('BULLISH', volRegime),
    '4h': tfState('BULLISH'),
  },
  liquidity: { nearestHigh: 110, nearestLow: 90, sweepDetected: false, sweepSide: 'NONE' },
  futures: { fundingRate: 0.0001, openInterest: 1000, openInterestChange: 0, markPrice: 100, indexPrice: 100 },
  microstructure,
});

const candidate = (confidence = 0.7, htfAlignment = 2) => ({
  direction: 'LONG' as const,
  confidence,
  htfAlignment,
});

describe('resolveLeverage', () => {
  it('always returns an integer in [MIN_LEVERAGE, MAX_LEVERAGE]', () => {
    const states: Array<[MarketState['regime'], CircuitState]> = [
      ['TREND_UP', 'NORMAL'], ['TREND_DOWN', 'CAUTION'], ['RANGE', 'REDUCED'],
      ['PANIC', 'HALTED'], ['HIGH_VOLATILITY', 'EMERGENCY'],
    ];
    for (const [regime, circuit] of states) {
      const lev = resolveLeverage(makeState(regime), candidate(), circuit);
      expect(lev).toBeGreaterThanOrEqual(MIN_LEVERAGE);
      expect(lev).toBeLessThanOrEqual(MAX_LEVERAGE);
      expect(Number.isInteger(lev)).toBe(true);
    }
  });

  it('TREND_UP with full alignment and high confidence yields high leverage', () => {
    const lev = resolveLeverage(makeState('TREND_UP', 'TREND_UP'), candidate(0.9, 3), 'NORMAL');
    expect(lev).toBeGreaterThanOrEqual(12);
  });

  it('PANIC or EMERGENCY circuit caps leverage at MIN_LEVERAGE', () => {
    const levHalted = resolveLeverage(makeState('RANGE'), candidate(0.9, 3), 'HALTED');
    const levEmergency = resolveLeverage(makeState('TREND_UP'), candidate(0.9, 3), 'EMERGENCY');
    expect(levHalted).toBe(MIN_LEVERAGE);
    expect(levEmergency).toBe(MIN_LEVERAGE);
  });

  it('CAUTION circuit caps leverage at 10', () => {
    const lev = resolveLeverage(makeState('TREND_UP', 'TREND_UP'), candidate(0.95, 3), 'CAUTION');
    expect(lev).toBeLessThanOrEqual(10);
  });

  it('REDUCED circuit caps leverage at 7', () => {
    const lev = resolveLeverage(makeState('TREND_UP', 'TREND_UP'), candidate(0.95, 3), 'REDUCED');
    expect(lev).toBeLessThanOrEqual(7);
  });

  it('HIGH_VOLATILITY penalises leverage', () => {
    const normal = resolveLeverage(makeState('TREND_UP', 'TREND_UP', 'NORMAL'), candidate(0.7, 2), 'NORMAL');
    const highVol = resolveLeverage(makeState('TREND_UP', 'TREND_UP', 'HIGH_VOLATILITY'), candidate(0.7, 2), 'NORMAL');
    expect(highVol).toBeLessThan(normal);
  });

  it('confirming microstructure adds a leverage bonus', () => {
    const micro = {
      spreadBps: 1, bidDepth: 100, askDepth: 80, imbalance: 0.2,
      buyVolume: 500, sellVolume: 200, tradeDelta: 300, flowBias: 'BUY' as const, updatedAt: Date.now(),
    };
    const noMicro = resolveLeverage(makeState('TREND_UP'), candidate(0.6, 2), 'NORMAL');
    const withMicro = resolveLeverage(makeState('TREND_UP', 'RANGE', 'NORMAL', micro), candidate(0.6, 2), 'NORMAL');
    expect(withMicro).toBeGreaterThanOrEqual(noMicro);
  });

  it('PANIC regime always returns MIN_LEVERAGE regardless of circuit', () => {
    const lev = resolveLeverage(makeState('PANIC'), candidate(0.9, 3), 'NORMAL');
    expect(lev).toBe(MIN_LEVERAGE);
  });
});
