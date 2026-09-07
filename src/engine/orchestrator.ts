import { PriceWatcher } from './watcher.js';
import { TradeJournal } from './journal.js';
import { runTradingAgent } from '../agent.js';
import { sendTelegramAlert, sendTelegramStatus } from '../notifications/telegram.js';
import { SymbolLanes } from '../engines/event-bus.js';
import type { MarketTicker, WatchCondition, WatchTriggerEvent, WatcherStatus } from '../types.js';

type TriggerListener = (event: WatchTriggerEvent, analysis: string) => void;
type TickListener = (symbol: string, price: number) => void;
export type AgentRunner = (prompt: string, event: WatchTriggerEvent) => Promise<string>;

/**
 * Orchestrates the full pipeline:
 *   WebSocket tick → condition match → agent re-analysis → Telegram alert
 *
 * Usage:
 *   const orchestrator = new WatchOrchestrator();
 *   orchestrator.start();
 *   orchestrator.addWatch({ ... });
 */
export class WatchOrchestrator {
  private readonly watcher: PriceWatcher;
  public readonly journal: TradeJournal;
  private readonly listeners = new Set<TriggerListener>();
  private readonly tickListeners = new Set<TickListener>();
  /** Per-symbol serialized lanes — BTC and SOL no longer block each other. */
  private readonly lanes = new SymbolLanes();
  private agentRunner?: AgentRunner;

  constructor(baseStreamUrl?: string, journal?: TradeJournal) {
    this.watcher = new PriceWatcher(baseStreamUrl);
    this.journal = journal ?? new TradeJournal();
  }

  setAgentRunner(runner?: AgentRunner): void {
    this.agentRunner = runner;
  }

  start(): void {
    this.watcher.start();
    this.watcher.on('trigger', (event: WatchTriggerEvent) => {
      void this.handleTrigger(event);
    });
    this.watcher.on('tick', (tick: { symbol: string; price: number }) => {
      for (const listener of this.tickListeners) listener(tick.symbol, tick.price);
    });
    this.watcher.on('connected', () => {
      void sendTelegramStatus('📡 Price watcher connected to Binance WebSocket');
    });
    this.watcher.on('error', (err: Error) => {
      void sendTelegramStatus(`⚠️ Watcher error: ${err.message}`);
    });
  }

  addWatch(condition: WatchCondition): void {
    this.watcher.addWatch(condition);
  }

  removeWatch(id: string): boolean {
    return this.watcher.removeWatch(id);
  }

  getStatuses(): WatcherStatus[] {
    return this.watcher.getStatuses();
  }

  getMarketTickers(): MarketTicker[] {
    return this.watcher.getMarketTickers();
  }

  onTrigger(listener: TriggerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  stop(): void {
    this.watcher.stop();
    this.listeners.clear();
    this.tickListeners.clear();
  }

  private handleTrigger(event: WatchTriggerEvent): Promise<void> {
    // Serialized per symbol; different symbols process in parallel.
    return this.lanes.enqueue(event.condition.symbol, async () => {
      try {
        const active = this.journal.findActiveTrade(event.condition.symbol);
        let prompt = event.condition.reEvaluationPrompt;
        if (active) {
          prompt += `\n[System Alert: Active ${active.direction} trade exists for ${event.condition.symbol} (Entry: ${active.entryPrice}, SL: ${active.stopLoss}, TP: ${active.takeProfit}). If this hit TP/SL, execute record_trade_outcome with post-mortem critique and lessons learned.]`;
        }
        const analysis = await (this.agentRunner
          ? this.agentRunner(prompt, event)
          : runTradingAgent(prompt, { orchestrator: this }));
        await sendTelegramAlert(event, analysis);
        for (const listener of this.listeners) listener(event, analysis);
      } catch (err) {
        await sendTelegramStatus(
          `⚠️ Re-analysis failed for ${event.condition.symbol}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }
}
