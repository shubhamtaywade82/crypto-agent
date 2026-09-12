import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { createResearchAgent, ResearchAgent } from '../src/agent.js';
import { RESEARCH_AGENT_CHARTER } from '../src/prompts.js';
import type { ResearchContext } from '../src/context.js';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number, startTs = 1_700_000_000_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0);
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2;
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2;
    const volume = 1000 + Math.abs(Math.sin(i / 5)) * 500;
    candles.push({
      timestamp: startTs + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal(volume.toFixed(4)),
    });
    price = close;
  }
  return candles;
}

function makeContext(candleCount = 300): ResearchContext {
  return {
    symbol: 'ETHUSDT',
    timeframe: '15m',
    candles: makeCandles(candleCount),
  };
}

describe('research-agent', () => {
  it('constructs without contacting Ollama', () => {
    const ctx = makeContext();
    const agent = createResearchAgent(ctx);
    expect(agent).toBeInstanceOf(ResearchAgent);
    // Catalogue is wired and exposes every deterministic tool.
    const names = agent.tools.slotNames();
    expect(names).toContain('list_event_detectors');
    expect(names).toContain('detect_events');
    expect(names).toContain('get_market_context');
    expect(names).toContain('run_study');
    expect(names).toContain('run_event_study');
    expect(names).toContain('evaluate_interaction');
    expect(names).toContain('evaluate_negative_evidence');
    expect(names).toContain('run_walk_forward');
    expect(names).toContain('dataset_summary');
  });

  it('exposes the research charter and exposes deterministic tools via invokeTool', async () => {
    expect(RESEARCH_AGENT_CHARTER).toMatch(/Market Intelligence Research Agent/);
    expect(RESEARCH_AGENT_CHARTER).toMatch(/deterministic/);

    const ctx = makeContext();
    const agent = createResearchAgent(ctx);
    const res = await agent.invokeTool('dataset_summary', {});
    expect(res.success).toBe(true);
    const out = res.output as { symbol: string; candleCount: number };
    expect(out.symbol).toBe('ETHUSDT');
    expect(out.candleCount).toBe(300);
  });

  it('honours environment-variable fallbacks for Ollama base URL and model', () => {
    const prevUrl = process.env.OLLAMA_BASE_URL;
    const prevModel = process.env.RESEARCH_AGENT_MODEL;
    process.env.OLLAMA_BASE_URL = 'http://remote-ollama:11434';
    process.env.RESEARCH_AGENT_MODEL = 'qwen2.5:7b';

    try {
      // Construction itself does not call Ollama, so this is safe.
      const agent = createResearchAgent(makeContext());
      expect(agent).toBeInstanceOf(ResearchAgent);
    } finally {
      if (prevUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = prevUrl;
      if (prevModel === undefined) delete process.env.RESEARCH_AGENT_MODEL;
      else process.env.RESEARCH_AGENT_MODEL = prevModel;
    }
  });
});
