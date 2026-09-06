import { PriceWatcher } from './watcher.js';
import { runTradingAgent } from '../agent.js';
import { sendTelegramAlert, sendTelegramStatus } from '../notifications/telegram.js';
import type { WatchCondition, WatchTriggerEvent, WatcherStatus } from '../types.js';

type TriggerListener = (event: WatchTriggerEvent, analysis: string) => void;

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
  private readonly listeners = new Set<TriggerListener>();
  private processing = false;

  constructor(baseStreamUrl?: string) {
    this.watcher = new PriceWatcher(baseStreamUrl);
  }

  start(): void {
    this.watcher.start();
    this.watcher.on('trigger', (event: WatchTriggerEvent) => {
      void this.handleTrigger(event);
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

  onTrigger(listener: TriggerListener): void {
    this.listeners.add(listener);
  }

  stop(): void {
    this.watcher.stop();
    this.listeners.clear();
  }

  private async handleTrigger(event: WatchTriggerEvent): Promise<void> {
    // Serialize re-analysis to avoid concurrent LLM calls
    if (this.processing) return;
    this.processing = true;

    try {
      const analysis = await runTradingAgent(event.condition.reEvaluationPrompt);
      await sendTelegramAlert(event, analysis);
      for (const listener of this.listeners) listener(event, analysis);
    } finally {
      this.processing = false;
    }
  }
}
