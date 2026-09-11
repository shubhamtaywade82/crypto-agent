import { describe, expect, it } from 'vitest';
import { mergeScanOpportunities, opportunitiesFromTrace } from '../src/ui/scan-opportunities.js';
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
});
