import { z } from 'zod';
import { defineTool, type AnyTool } from '@nemesis-oss/ollama-sdk';
import type { TradeJournal } from './journal.js';

export const createLogTradeSetupTool = (journal: TradeJournal): AnyTool =>
  defineTool({
    name: 'log_trade_setup',
    description:
      'Log a planned trade setup with explicit entry, stop loss, take profit, and thesis. ' +
      'Tracks lifecycle and enables automated post-mortem learning upon exit.',
    schema: z.object({
      symbol: z.string().describe('Trading pair, e.g. SOLUSDT'),
      direction: z.enum(['LONG', 'SHORT']).describe('Trade direction'),
      entryPrice: z.number().describe('Planned entry price'),
      stopLoss: z.number().describe('Stop loss price level'),
      takeProfit: z.number().describe('Take profit price level'),
      strategy: z.string().describe('Strategy name, e.g. Breakout Buy'),
      thesis: z.string().describe('Reasoning and market context for this trade'),
    }),
    execute: async (input) => {
      const record = journal.logSetup({
        symbol: input.symbol.toUpperCase(),
        direction: input.direction,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        strategy: input.strategy,
        thesis: input.thesis,
      });
      return { success: true, tradeId: record.id, status: record.status };
    },
  });

export const createRecordTradeOutcomeTool = (journal: TradeJournal): AnyTool =>
  defineTool({
    name: 'record_trade_outcome',
    description:
      'Record the exit of a trade with post-mortem critique and actionable lesson learned. ' +
      'Saves lesson to adaptive memory to improve future trade recommendations.',
    schema: z.object({
      tradeId: z.string().optional().describe('ID of the trade. If omitted, matches latest active trade for symbol'),
      symbol: z.string().optional().describe('Trading pair symbol (e.g. SOLUSDT) to look up active trade'),
      exitPrice: z.number().describe('Actual exit price'),
      postMortem: z.string().describe('Critique: why did the trade succeed or fail?'),
      lessonLearned: z.string().describe('Actionable lesson for future setups (e.g. "Wait for 1h close on SOL breakouts")'),
    }),
    execute: async (input) => {
      const targetId = input.tradeId ?? (input.symbol ? journal.findActiveTrade(input.symbol)?.id : undefined);
      if (!targetId) return { error: `No active trade found for ${input.tradeId ?? input.symbol ?? 'unknown'}` };
      const updated = journal.closeTrade(targetId, input.exitPrice, input.postMortem, input.lessonLearned);
      if (!updated) return { error: `Trade ${targetId} could not be closed` };
      return {
        success: true,
        tradeId: updated.id,
        outcome: updated.outcome,
        pnlPercent: updated.pnlPercent,
        rMultiple: updated.rMultiple,
        lessonSaved: updated.lessonLearned,
      };
    },
  });

export const createGetTradeJournalTool = (journal: TradeJournal): AnyTool =>
  defineTool({
    name: 'get_trade_journal',
    description: 'Retrieve trade history, active setups, and cumulative win rate/PnL performance stats.',
    schema: z.object({
      status: z.enum(['PENDING', 'OPEN', 'CLOSED']).optional().describe('Filter by trade status'),
    }),
    execute: async (input) => {
      const trades = journal.getTrades(input.status);
      const stats = journal.getStats();
      return { stats, trades: trades.slice(-10) };
    },
  });

export const createGetLearnedRulesTool = (journal: TradeJournal): AnyTool =>
  defineTool({
    name: 'get_learned_rules',
    description: 'Retrieve recent adaptive rules and lessons learned from past winning and losing trades.',
    schema: z.object({
      symbol: z.string().optional().describe('Optional symbol filter, e.g. SOLUSDT'),
    }),
    execute: async (input) => {
      const lessons = journal.getRecentLessons(input.symbol);
      return { count: lessons.length, lessons };
    },
  });
