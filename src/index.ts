import { fileURLToPath } from 'node:url';
import { runTradingAgent } from './agent.js';

export * from './types.js';
export * from './config.js';
export * from './tools.js';
export * from './agent.js';
export { PriceWatcher } from './engine/watcher.js';
export { WatchOrchestrator } from './engine/orchestrator.js';
export { TradeJournal } from './engine/journal.js';
export { AutonomousScanner, buildScanPrompt } from './engine/scanner.js';
export { sendTelegramAlert, sendTelegramStatus } from './notifications/telegram.js';

// Trading kernel v2
export { createKernel, getKernel } from './kernel.js';
export type { TradingKernel, ExecutionVenue, AssessResult } from './kernel.js';
export { SymbolLanes } from './engines/event-bus.js';
export { EventStore } from './infrastructure/events/event-store.js';
export { loadRiskLimits, DEFAULT_RISK_LIMITS, deriveCircuitState } from './domain/risk/risk-config.js';
export { evaluateRisk } from './engines/risk-engine.js';
export { sizePosition } from './engines/position-sizer.js';
export { validateProposal, computeRr } from './domain/orders/trade-proposal.js';
export { detectSetups } from './engines/setup-engine.js';
export { buildMarketState } from './engines/market-state-engine.js';
export { runTradingPipeline } from './engines/pipeline.js';
export type { PipelineTrace, PipelineStatus } from './engines/pipeline.js';

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const prompt =
    process.argv.slice(2).join(' ') ||
    'Compare BTCUSDT and ETHUSDT price and volume';
  process.stdout.write(`🤖 Prompt: ${prompt}\n\n`);
  const answer = await runTradingAgent(prompt);
  process.stdout.write(`📊 Agent response:\n${answer}\n`);
}
