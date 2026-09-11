import { describe, expect, it } from 'vitest';
import { formatCouncilTelegram } from '../src/notifications/council-telegram.js';
import type { PipelineTrace } from '../src/engines/pipeline.js';

const baseTrace = (): PipelineTrace => ({
  symbol: 'SOLUSDT',
  ranAt: Date.now(),
  status: 'WAIT',
  regime: 'TREND_DOWN',
  setups: [{
    id: 's1', type: 'PULLBACK_RECLAIM', symbol: 'SOLUSDT', direction: 'LONG',
    entry: 100, stopLoss: 98, takeProfit: 105, orderType: 'MARKET', leverage: 1,
    rr: 2.5, confidence: 0.7, htfAlignment: 2, thesis: 'reclaim', invalidation: '98',
    warnings: [],
  }],
  analysis: {
    symbol: 'SOLUSDT',
    bias: 'NEUTRAL',
    summary: 'Price trapped between sweep low and 4h support.',
    keyLevels: { support: 98.3, resistance: 100.2 },
    catalysts: ['BTC stabilization'],
    risks: ['Macro headwind'],
  },
  outcome: {
    action: 'WAIT',
    confidence: 0.55,
    thesis: 'Wait for reclaim confirmation.',
    invalidation: 'Break below 98.3',
    setupType: 'PULLBACK_RECLAIM',
  },
});

describe('formatCouncilTelegram', () => {
  it('includes analyst, strategist, and trigger context', () => {
    const text = formatCouncilTelegram(
      { type: 'PRICE_WATCH', event: {
        condition: {
          id: 'w1', symbol: 'SOLUSDT', strategy: 'Reclaim', type: 'price_above',
          targetPrice: 100.2, cooldownMs: 0, createdAt: 0, reEvaluationPrompt: '',
        },
        currentPrice: 100.25,
        triggeredAt: Date.now(),
      } },
      baseTrace()
    );
    expect(text).toContain('Council');
    expect(text).toContain('Analyst');
    expect(text).toContain('Strategist');
    expect(text).toContain('NEUTRAL');
    expect(text).toContain('WAIT');
    expect(text).toContain('100.2');
  });

  it('formats market-intelligence event triggers', () => {
    const text = formatCouncilTelegram(
      {
        type: 'MARKET_EVENT', symbol: 'SOLUSDT', timeframe: '1h',
        eventType: 'liquidity_sweep', eventId: 'sweep-1', direction: 'bearish',
        label: 'bearish ssl sweep @ 99.87 (reclaimed=true)',
      },
      baseTrace()
    );
    expect(text).toContain('ssl sweep');
    expect(text).toContain('SOLUSDT');
  });
});
