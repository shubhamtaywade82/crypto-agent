import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LearnedLesson, TradeOutcome, TradeRecord } from '../types.js';

interface JournalData {
  readonly trades: TradeRecord[];
  readonly lessons: LearnedLesson[];
}

const computePnlAndR = (
  trade: TradeRecord,
  exitPrice: number
): { pnlPercent: number; rMultiple: number; outcome: TradeOutcome } => {
  const isLong = trade.direction === 'LONG';
  const rawPnl = isLong
    ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  const diff = isLong ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
  const rMultiple = risk > 0 ? Number((diff / risk).toFixed(2)) : 0;
  const pnlPercent = Number(rawPnl.toFixed(2));
  const outcome: TradeOutcome = pnlPercent > 0.2 ? 'WIN' : pnlPercent < -0.2 ? 'LOSS' : 'SCRATCH';
  return { pnlPercent, rMultiple, outcome };
};

export class TradeJournal {
  private trades: TradeRecord[] = [];
  private lessons: LearnedLesson[] = [];
  private readonly filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath ?? path.join(os.homedir(), '.crypto_agent_journal.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as JournalData;
        this.trades = parsed.trades ?? [];
        this.lessons = parsed.lessons ?? [];
      }
    } catch {
      this.trades = [];
      this.lessons = [];
    }
  }

  private persist(): void {
    try {
      const data: JournalData = { trades: this.trades.slice(-200), lessons: this.lessons.slice(-50) };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* ignore disk write errors */ }
  }

  logSetup(input: Omit<TradeRecord, 'id' | 'createdAt' | 'status'>): TradeRecord {
    const record: TradeRecord = {
      ...input,
      id: `${input.symbol}-${input.direction}-${Date.now()}`,
      status: 'PENDING',
      createdAt: Date.now(),
    };
    this.trades.push(record);
    this.persist();
    return record;
  }

  openTrade(id: string, actualEntry?: number): TradeRecord | undefined {
    const idx = this.trades.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const current = this.trades[idx]!;
    const updated: TradeRecord = {
      ...current,
      status: 'OPEN',
      openedAt: Date.now(),
      entryPrice: actualEntry ?? current.entryPrice,
    };
    this.trades[idx] = updated;
    this.persist();
    return updated;
  }

  closeTrade(id: string, exitPrice: number, postMortem?: string, lessonLearned?: string): TradeRecord | undefined {
    const idx = this.trades.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const current = this.trades[idx]!;
    const { pnlPercent, rMultiple, outcome } = computePnlAndR(current, exitPrice);

    if (lessonLearned) {
      this.lessons.push({
        id: `lesson-${Date.now()}`,
        symbol: current.symbol,
        lesson: lessonLearned,
        context: `${current.strategy} (${outcome} ${rMultiple}R)`,
        timestamp: Date.now(),
      });
    }

    const updated: TradeRecord = {
      ...current,
      status: 'CLOSED',
      closedAt: Date.now(),
      exitPrice,
      pnlPercent,
      rMultiple,
      outcome,
      postMortem,
      lessonLearned,
    };
    this.trades[idx] = updated;
    this.persist();
    return updated;
  }

  getRecentLessons(symbol?: string, limit = 5): LearnedLesson[] {
    const filtered = symbol
      ? this.lessons.filter((l) => l.symbol.toUpperCase() === symbol.toUpperCase())
      : this.lessons;
    return filtered.slice(-limit).reverse();
  }

  findActiveTrade(symbol: string): TradeRecord | undefined {
    const sym = symbol.toUpperCase();
    return this.trades.slice().reverse().find((t) => t.symbol === sym && t.status !== 'CLOSED');
  }

  getTrades(status?: TradeRecord['status']): readonly TradeRecord[] {
    return status ? this.trades.filter((t) => t.status === status) : this.trades;
  }

  getStats(): { total: number; wins: number; losses: number; winRate: number; avgR: number } {
    const closed = this.trades.filter((t) => t.status === 'CLOSED');
    if (closed.length === 0) return { total: 0, wins: 0, losses: 0, winRate: 0, avgR: 0 };
    const wins = closed.filter((t) => t.outcome === 'WIN').length;
    const losses = closed.filter((t) => t.outcome === 'LOSS').length;
    const totalR = closed.reduce((acc, t) => acc + (t.rMultiple ?? 0), 0);
    return {
      total: closed.length,
      wins,
      losses,
      winRate: Number(((wins / closed.length) * 100).toFixed(1)),
      avgR: Number((totalR / closed.length).toFixed(2)),
    };
  }
}
