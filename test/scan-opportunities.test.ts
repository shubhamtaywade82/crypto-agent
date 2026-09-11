import { describe, expect, it } from 'vitest';
import {
  marketFromTrace, mergeMonitoredMarkets,
  mergeScanOpportunities, opportunitiesFromTrace,
} from '../src/ui/scan-opportunities.js';
import type { PipelineTrace } from '../src/engines/pipeline.js';

const baseTrace = (over?: Partial<PipelineTrace>): PipelineTrace => ({
  symbol: 'BTCUSDT',
  ranAt: Date.now(),
  status: 'NO_SETUPS',
  regime: 'TREND_UP',
  setups: [],
  ...over,
});

describe('scan-opportunities', () => {
  it('maps pipeline setups into ranked opportunity rows', () => {
    const rows = opportunitiesFromTrace('BTCUSDT', baseTrace({
      setups: [{
        id: 's1', type: 'PULLBACK_RECLAIM', symbol: 'BTCUSDT', direction: 'LONG',
        entry: 100, stopLoss: 95, takeProfit: 110, orderType: 'MARKET', leverage: 2,
        rr: 2.8, htfAlignment: 3, confidence: 0.78, thesis: 'HTF trend intact',
        invalidation: '15m break', warnings: [], valid: true,
      }],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.setup).toBe('Pullback Reclaim');
    expect(rows[0]?.state).toBe('WATCH');
  });

  it('merges scans by symbol+setup keeping latest', () => {
    const a = opportunitiesFromTrace('BTCUSDT', baseTrace({
      setups: [{
        id: 's1', type: 'BREAKOUT_RETEST', symbol: 'BTCUSDT', direction: 'LONG',
        entry: 100, stopLoss: 95, takeProfit: 110, orderType: 'MARKET', leverage: 2,
        rr: 3, htfAlignment: 3, confidence: 0.6, thesis: 'old', invalidation: 'x', warnings: [], valid: true,
      }],
    }));
    const b = opportunitiesFromTrace('BTCUSDT', baseTrace({
      setups: [{
        id: 's1', type: 'BREAKOUT_RETEST', symbol: 'BTCUSDT', direction: 'LONG',
        entry: 100, stopLoss: 95, takeProfit: 110, orderType: 'MARKET', leverage: 2,
        rr: 3, htfAlignment: 3, confidence: 0.9, thesis: 'new', invalidation: 'x', warnings: [], valid: true,
      }],
    }));
    const merged = mergeScanOpportunities(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.confidence).toBe(0.9);
    expect(merged[0]?.thesis).toBe('new');
  });

  it('extracts monitored market state from trace even when setups are empty', () => {
    const trace = baseTrace({
      regime: 'TREND_DOWN',
      state: {
        symbol: 'BTCUSDT',
        capturedAt: Date.now(),
        regime: 'TREND_DOWN',
        btcRegime: 'TREND_DOWN',
        price: { last: 77000, mark: 77200, index: 77190, fundingRate: 0.0001, spreadBps: 0.5 },
        liquidity: { nearestHigh: 80000, nearestLow: 75000, sweepDetected: false, sweepSide: 'NONE' },
        orderBookImbalance: 0.1,
        timeframes: {
          '5m': { structure: { trend: 'BEARISH' } } as any,
          '15m': { structure: { trend: 'BEARISH' } } as any,
          '1h': { structure: { trend: 'BEARISH' } } as any,
          '4h': { structure: { trend: 'BEARISH' } } as any,
        },
      },
    });
    const market = marketFromTrace('BTCUSDT', trace);
    expect(market.symbol).toBe('BTCUSDT');
    expect(market.price).toBe(77200);
    expect(market.regime).toBe('TREND_DOWN');
    expect(market.trend).toBe('BEARISH');
    expect(market.setupsCount).toBe(0);
  });

  it('merges monitored markets by symbol', () => {
    const m1 = { symbol: 'BTCUSDT', price: 77000, regime: 'RANGE', trend: 'NEUTRAL', scannedAt: '12:00:00', setupsCount: 0 };
    const m2 = { symbol: 'BTCUSDT', price: 77500, regime: 'TREND_UP', trend: 'BULLISH', scannedAt: '12:05:00', setupsCount: 1 };
    const m3 = { symbol: 'SOLUSDT', price: 150, regime: 'RANGE', trend: 'NEUTRAL', scannedAt: '12:05:00', setupsCount: 0 };
    const merged = mergeMonitoredMarkets([m1], m2);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.price).toBe(77500);
    expect(merged[0]?.regime).toBe('TREND_UP');

    const withSol = mergeMonitoredMarkets(merged, m3);
    expect(withSol).toHaveLength(2);
  });
});
