import { runTradingAgent } from '../agent.js';
import type { WatchOrchestrator } from './orchestrator.js';

export const TARGET_ALTCOINS = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'] as const;
export const MACRO_COIN = 'BTCUSDT';

export const buildScanPrompt = (targets: readonly string[] = TARGET_ALTCOINS): string =>
  `[AUTONOMOUS SCAN CYCLE]
1. Macro Filter: Inspect ${MACRO_COIN} 24h ticker and 1h klines. Determine whether the macro regime is Bullish, Bearish, or Choppy/Ranging.
2. Screening: Screen altcoins (${targets.join(', ')}). Look for high-probability setups aligned with the macro regime.
3. Adaptive Memory: Check get_learned_rules to avoid repeating past mistakes.
4. If a valid setup (R:R >= 2.0) is identified:
   - Compute position size with calculate_position_size.
   - Record the setup via log_trade_setup.
   - Register price watches (entry, take-profit, stop-loss) using register_price_watch.
   - If market entry is warranted, execute paper_broker_place_order.
5. Summarize key findings, macro assessment, and any setups/watches created.`;

export interface ScannerOptions {
  readonly orchestrator: WatchOrchestrator;
  readonly targets?: readonly string[];
  readonly macroCoin?: string;
  readonly intervalMs?: number;
  readonly onScanResult?: (result: string) => void;
  readonly onScanError?: (err: Error) => void;
}

export class AutonomousScanner {
  private readonly orchestrator: WatchOrchestrator;
  private readonly targets: readonly string[];
  private readonly onScanResult?: (result: string) => void;
  private readonly onScanError?: (err: Error) => void;
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private lastScanTimestamp?: number;
  private completedScans = 0;

  constructor(opts: ScannerOptions) {
    this.orchestrator = opts.orchestrator;
    this.targets = opts.targets ?? TARGET_ALTCOINS;
    this.onScanResult = opts.onScanResult;
    this.onScanError = opts.onScanError;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get isScanning(): boolean {
    return this.scanning;
  }

  get lastScan(): number | undefined {
    return this.lastScanTimestamp;
  }

  get totalScans(): number {
    return this.completedScans;
  }

  async scanOnce(): Promise<string> {
    if (this.scanning) return 'Scan already in progress.';
    this.scanning = true;

    try {
      const prompt = buildScanPrompt(this.targets);
      const result = await runTradingAgent(prompt, { orchestrator: this.orchestrator });
      this.lastScanTimestamp = Date.now();
      this.completedScans += 1;
      this.onScanResult?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onScanError?.(error);
      throw error;
    } finally {
      this.scanning = false;
    }
  }

  start(intervalMs = 300_000): void {
    if (this.timer) return;
    void this.scanOnce();
    this.timer = setInterval(() => {
      void this.scanOnce();
    }, intervalMs);
    // Unref timer so it does not prevent Node event loop termination
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
