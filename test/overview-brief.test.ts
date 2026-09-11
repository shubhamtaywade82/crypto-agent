import { describe, expect, it } from 'vitest';
import { buildTraderBrief } from '../src/ui/overview-brief.js';
import type { PipelineTrace } from '../src/engines/pipeline.js';

describe('buildTraderBrief', () => {
  it('returns MONITOR when no pipeline trace exists', () => {
    const brief = buildTraderBrief('BTCUSDT', {}, []);
    expect(brief.stance).toBe('MONITOR');
    expect(brief.headline).toContain('/pipeline');
  });

  it('returns LONG when execute approved with long setup', () => {
    const trace: PipelineTrace = {
      symbol: 'BTCUSDT',
      ranAt: Date.now(),
      status: 'APPROVED',
      regime: 'TREND_UP',
      setups: [{
        id: 's1', type: 'PULLBACK_RECLAIM', symbol: 'BTCUSDT', direction: 'LONG',
        entry: 100, stopLoss: 95, takeProfit: 115, orderType: 'LIMIT', leverage: 2,
        rr: 3, htfAlignment: 0.8, confidence: 0.75, thesis: 'reclaim', invalidation: 'below 95',
        warnings: [], valid: true,
      }],
      outcome: { action: 'EXECUTE', candidateId: 's1', confidence: 0.8, thesis: 'go long', invalidation: 'below 95', setupType: 'PULLBACK_RECLAIM' },
      risk: { approved: true, circuitState: 'NORMAL', reasons: [] },
    };
    const brief = buildTraderBrief('BTCUSDT', { BTCUSDT: trace }, []);
    expect(brief.stance).toBe('LONG');
    expect(brief.levels.entry).toBe(100);
  });

  it('returns AVOID when risk challenger opposes', () => {
    const trace: PipelineTrace = {
      symbol: 'BTCUSDT', ranAt: Date.now(), status: 'REJECTED', regime: 'RANGE', setups: [],
      challenge: { verdict: 'OPPOSE', summary: 'weak structure', objections: [] },
    };
    const brief = buildTraderBrief('BTCUSDT', { BTCUSDT: trace }, []);
    expect(brief.stance).toBe('AVOID');
  });
});
