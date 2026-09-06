import { z } from 'zod';
import { defineTool, type AnyTool } from '@nemesis-oss/ollama-sdk';
import type { WatchOrchestrator } from './orchestrator.js';
import type { WatchCondition } from '../types.js';

const watchSchema = z.object({
  symbol: z.string().describe('Trading pair, e.g. SOLUSDT'),
  type: z.enum(['price_above', 'price_below']).describe('Trigger direction'),
  targetPrice: z.number().describe('Price level that triggers re-analysis'),
  strategy: z.string().describe('Short label, e.g. "Breakout Buy"'),
  reEvaluationPrompt: z.string().describe(
    'Prompt sent to the agent when the condition fires. ' +
    'Include the symbol, expected action, and what to verify.'
  ),
  cooldownMinutes: z.number().default(5).describe(
    'Minutes to wait before re-triggering the same watch (default 5)'
  ),
});

type WatchInput = z.infer<typeof watchSchema>;

const buildCondition = (input: WatchInput): WatchCondition => ({
  id: `${input.symbol}-${input.type}-${Date.now()}`,
  symbol: input.symbol.toUpperCase(),
  type: input.type,
  targetPrice: input.targetPrice,
  strategy: input.strategy,
  reEvaluationPrompt: input.reEvaluationPrompt,
  cooldownMs: (input.cooldownMinutes ?? 5) * 60_000,
  createdAt: Date.now(),
});

export const createRegisterWatchTool = (orchestrator: WatchOrchestrator): AnyTool =>
  defineTool({
    name: 'register_price_watch',
    description:
      'Register a live WebSocket price watch. When the target price is hit, ' +
      'the agent is automatically re-triggered for confirmation analysis ' +
      'and a Telegram notification is sent.',
    schema: watchSchema,
    execute: async (input) => {
      const condition = buildCondition(input);
      orchestrator.addWatch(condition);
      return {
        id: condition.id,
        status: 'watching',
        symbol: condition.symbol,
        targetPrice: condition.targetPrice,
        type: condition.type,
      };
    },
  });

export const createListWatchesTool = (orchestrator: WatchOrchestrator): AnyTool =>
  defineTool({
    name: 'list_active_watches',
    description: 'List all currently active WebSocket price watches',
    schema: z.object({}),
    execute: async () => {
      const statuses = orchestrator.getStatuses();
      return { count: statuses.length, watches: statuses };
    },
  });

export const createRemoveWatchTool = (orchestrator: WatchOrchestrator): AnyTool =>
  defineTool({
    name: 'remove_price_watch',
    description: 'Remove an active price watch by its ID',
    schema: z.object({
      id: z.string().describe('Watch ID returned by register_price_watch'),
    }),
    execute: async (input) => {
      const removed = orchestrator.removeWatch(input.id);
      return { id: input.id, removed };
    },
  });
