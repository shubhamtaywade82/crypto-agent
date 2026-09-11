import { describe, expect, it, vi } from 'vitest';
import { emitCouncilPipelineTrace, onCouncilPipelineTrace } from '../src/engines/pipeline-trace-bus.js';
import { councilTriggerEntry } from '../src/ui/transcript.js';

describe('pipeline-trace-bus', () => {
  it('notifies subscribers when council pipeline completes', () => {
    const fn = vi.fn();
    const off = onCouncilPipelineTrace(fn);
    const trace = {
      symbol: 'BTCUSDT', ranAt: Date.now(), status: 'NO_SETUPS' as const,
      regime: 'RANGE', setups: [],
    };
    const trigger = { type: 'SETUP_DETECTED' as const, symbol: 'BTCUSDT', count: 2 };
    emitCouncilPipelineTrace({ symbol: 'BTCUSDT', trace, trigger });
    expect(fn).toHaveBeenCalledWith({ symbol: 'BTCUSDT', trace, trigger });
    off();
    emitCouncilPipelineTrace({ symbol: 'BTCUSDT', trace, trigger });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('formats council trigger transcript entries', () => {
    const entry = councilTriggerEntry({
      type: 'MARKET_EVENT', symbol: 'BTCUSDT', timeframe: '1h',
      eventType: 'choch', eventId: 'e1', direction: 'LONG', label: 'bullish choch',
    });
    expect(entry.actor).toBe('MARKET');
    expect(entry.title).toContain('MARKET_EVENT');
    expect(entry.lines.join(' ')).toContain('choch');
  });
});
