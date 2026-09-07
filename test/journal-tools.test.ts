import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TradeJournal } from '../src/engine/journal.js';
import {
  createLogTradeSetupTool,
  createRecordTradeOutcomeTool,
  createGetTradeJournalTool,
  createGetLearnedRulesTool,
} from '../src/engine/journal-tools.js';

describe('Journal Tools', () => {
  const tmpFile = path.join(os.tmpdir(), `test_journal_tools_${Date.now()}.json`);
  let journal: TradeJournal;

  beforeEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    journal = new TradeJournal(tmpFile);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('logs a trade setup via createLogTradeSetupTool', async () => {
    const tool = createLogTradeSetupTool(journal);
    const result = (await tool.execute({
      symbol: 'SOLUSDT',
      direction: 'LONG',
      entryPrice: 140,
      stopLoss: 135,
      takeProfit: 155,
      strategy: 'Breakout',
      thesis: 'Ascending triangle breakout',
    })) as { success: boolean; tradeId: string; status: string };

    expect(result.success).toBe(true);
    expect(result.status).toBe('PENDING');
    expect(result.tradeId).toContain('SOLUSDT');
  });

  it('records trade outcome and stores lesson via createRecordTradeOutcomeTool', async () => {
    journal.logSetup({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      entryPrice: 2000,
      stopLoss: 1900,
      takeProfit: 2200,
      strategy: 'Support Bounce',
      thesis: 'Daily 200 EMA bounce',
    });

    const tool = createRecordTradeOutcomeTool(journal);
    const result = (await tool.execute({
      symbol: 'ETHUSDT',
      exitPrice: 2200,
      postMortem: 'Hit target cleanly within 4 hours',
      lessonLearned: 'Support bounces at 200 EMA on ETH offer high R:R with low drawdown',
    })) as { success: boolean; outcome: string; pnlPercent: number; lessonSaved: string };

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('WIN');
    expect(result.pnlPercent).toBe(10);
    expect(result.lessonSaved).toContain('200 EMA');
  });

  it('fetches trade journal and stats via createGetTradeJournalTool', async () => {
    const logTool = createLogTradeSetupTool(journal);
    await logTool.execute({
      symbol: 'XRPUSDT',
      direction: 'SHORT',
      entryPrice: 0.6,
      stopLoss: 0.65,
      takeProfit: 0.5,
      strategy: 'Resistance Rejection',
      thesis: 'Bearish divergence at 0.60',
    });

    const journalTool = createGetTradeJournalTool(journal);
    const result = (await journalTool.execute({})) as {
      stats: { total: number };
      trades: unknown[];
    };

    expect(result.trades).toHaveLength(1);
  });

  it('retrieves learned rules via createGetLearnedRulesTool', async () => {
    const trade = journal.logSetup({
      symbol: 'SOLUSDT',
      direction: 'LONG',
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
      strategy: 'Breakout',
      thesis: 'Breakout',
    });

    journal.closeTrade(trade.id, 90, 'False breakout', 'Wait for 4h candle close above resistance');

    const rulesTool = createGetLearnedRulesTool(journal);
    const result = (await rulesTool.execute({ symbol: 'SOLUSDT' })) as {
      count: number;
      lessons: { lesson: string }[];
    };

    expect(result.count).toBe(1);
    expect(result.lessons[0]?.lesson).toContain('4h candle close');
  });
});
