import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TradeJournal } from '../src/engine/journal.js';

describe('TradeJournal', () => {
  const tmpFile = path.join(os.tmpdir(), `test_journal_${Date.now()}.json`);

  beforeEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('logs a new pending trade setup', () => {
    const journal = new TradeJournal(tmpFile);
    const trade = journal.logSetup({
      symbol: 'SOLUSDT',
      strategy: 'Breakout Buy',
      direction: 'LONG',
      entryPrice: 106,
      stopLoss: 104,
      takeProfit: 110,
      thesis: 'Consolidation breakout above resistance',
    });

    expect(trade.id).toContain('SOLUSDT-LONG');
    expect(trade.status).toBe('PENDING');
    expect(journal.getTrades('PENDING')).toHaveLength(1);
  });

  it('transitions trade to OPEN and then CLOSED with accurate PnL and R-multiple', () => {
    const journal = new TradeJournal(tmpFile);
    const trade = journal.logSetup({
      symbol: 'SOLUSDT',
      strategy: 'Breakout Buy',
      direction: 'LONG',
      entryPrice: 100,
      stopLoss: 95,
      takeProfit: 110,
      thesis: 'Breakout test',
    });

    journal.openTrade(trade.id, 100);
    expect(journal.getTrades('OPEN')).toHaveLength(1);

    // Close with win at 110 (+10% gain, +2.0R)
    const closed = journal.closeTrade(
      trade.id,
      110,
      'Breakout held strongly above $100',
      'Volume expansion on 1h candle is a strong confirmation indicator'
    );

    expect(closed?.status).toBe('CLOSED');
    expect(closed?.outcome).toBe('WIN');
    expect(closed?.pnlPercent).toBe(10);
    expect(closed?.rMultiple).toBe(2);
    expect(journal.getRecentLessons()).toHaveLength(1);
    expect(journal.getRecentLessons()[0]?.lesson).toContain('Volume expansion');
  });

  it('calculates loss correctly for short positions and updates stats', () => {
    const journal = new TradeJournal(tmpFile);
    const trade = journal.logSetup({
      symbol: 'ETHUSDT',
      strategy: 'Breakdown Short',
      direction: 'SHORT',
      entryPrice: 2500,
      stopLoss: 2600,
      takeProfit: 2300,
      thesis: 'Support breakdown',
    });

    journal.openTrade(trade.id);
    // Stopped out at 2600 (-4% loss, -1.0R)
    journal.closeTrade(trade.id, 2600, 'Fake breakdown', 'Avoid shorting into round support numbers');

    const stats = journal.getStats();
    expect(stats.total).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0);
    expect(stats.avgR).toBe(-1);
  });

  it('finds active trade by symbol and ignores closed trades', () => {
    const journal = new TradeJournal(tmpFile);
    expect(journal.findActiveTrade('XRPUSDT')).toBeUndefined();

    const trade = journal.logSetup({
      symbol: 'XRPUSDT',
      strategy: 'Range Low Buy',
      direction: 'LONG',
      entryPrice: 0.55,
      stopLoss: 0.52,
      takeProfit: 0.62,
      thesis: 'Range bounce',
    });

    expect(journal.findActiveTrade('XRPUSDT')?.id).toBe(trade.id);
    journal.closeTrade(trade.id, 0.62);
    expect(journal.findActiveTrade('XRPUSDT')).toBeUndefined();
  });
});
