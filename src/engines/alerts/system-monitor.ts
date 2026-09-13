import type { CircuitState, RiskLimits } from '../../domain/risk/risk-config.js';
import { deriveCircuitState } from '../../domain/risk/risk-config.js';
import type { MarketStateStore } from '../market-state-store.js';
import type { BinanceMarketStream, StreamState } from '../../infrastructure/binance/market-stream.js';
import type { EventStore } from '../../infrastructure/events/event-store.js';
import type { KillSwitch } from '../../security/kill-switch.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';

export interface SystemMonitorDeps {
  readonly store: EventStore;
  readonly marketStore: MarketStateStore;
  readonly dispatcher: AlertDispatcher;
  readonly symbols: () => readonly string[];
  readonly maxStaleMs: number;
  readonly stream?: BinanceMarketStream;
  readonly killSwitch?: KillSwitch;
  readonly limits: RiskLimits;
  readonly dailyLossPercent: () => number;
  readonly drawdownPercent: () => number;
  readonly lossStreak: () => number;
  readonly now?: () => number;
}

const streamLabel = (s: StreamState): string => s;

export class SystemMonitor {
  private lastStream?: StreamState;
  private lastFresh = true;
  private lastCircuit?: CircuitState;
  private lastKill?: boolean;
  private lastStoreOk = true;

  constructor(private readonly deps: SystemMonitorDeps) {}

  async tick(): Promise<void> {
    const now = this.deps.now?.() ?? Date.now();
    await this.checkStream();
    await this.checkFreshness(now);
    await this.checkCircuit();
    await this.checkKill();
    await this.checkAudit();
  }

  private async checkStream(): Promise<void> {
    const state = this.deps.stream?.state;
    if (!state || state === this.lastStream) return;
    const prev = this.lastStream;
    this.lastStream = state;
    if (state === 'DOWN' || state === 'RECONNECTING') {
      await this.emitWs(prev ?? 'LIVE', state, true);
      return;
    }
    if ((prev === 'DOWN' || prev === 'RECONNECTING') && state === 'LIVE') {
      await this.emitWs(prev, state, false);
    }
  }

  private async emitWs(from: string, to: string, down: boolean): Promise<void> {
    const symbols = this.deps.symbols().join(', ');
    await this.deps.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'SYSTEM',
      severity: down ? 'CRITICAL' : 'IMPORTANT',
      title: down ? 'BINANCE WS disconnected' : 'SYSTEM RECOVERED',
      body: down
        ? `Binance WebSocket: ${streamLabel(to as StreamState)}\nSymbols: ${symbols}\nFallback: REST recovery`
        : `Binance WebSocket: CONNECTED\nMarket state: FRESH\nTrading: RESUMED`,
      fingerprint: 'SYSTEM:binance:ws',
      stateFrom: from,
      stateTo: to,
      payload: { symbols: this.deps.symbols() },
    }));
  }

  private async checkFreshness(now: number): Promise<void> {
    const symbols = this.deps.symbols();
    const stale = symbols.filter((s) => !this.deps.marketStore.isFresh(s, this.deps.maxStaleMs, now)
      && this.deps.marketStore.stalenessMs(s, now) !== undefined);
    const fresh = stale.length === 0;
    if (fresh === this.lastFresh) return;
    this.lastFresh = fresh;
    const worst = stale[0];
    const age = worst ? (this.deps.marketStore.stalenessMs(worst, now) ?? 0) / 1000 : 0;
    await this.deps.dispatcher.publish(makeAlert({
      at: now,
      class: 'SYSTEM',
      severity: fresh ? 'IMPORTANT' : 'CRITICAL',
      symbol: worst,
      title: fresh ? 'SYSTEM RECOVERED' : 'DATA STALE',
      body: fresh
        ? `Market state: FRESH\nTrading: RESUMED`
        : `${worst} last update ${age.toFixed(1)}s ago\nMarket state: STALE\nTrading: PAUSED`,
      fingerprint: 'SYSTEM:stale',
      stateFrom: fresh ? 'STALE' : 'FRESH',
      stateTo: fresh ? 'FRESH' : 'STALE',
      payload: { stale },
    }));
  }

  private async checkCircuit(): Promise<void> {
    const next = deriveCircuitState(
      this.deps.dailyLossPercent(),
      this.deps.drawdownPercent(),
      this.deps.lossStreak(),
      this.deps.limits
    );
    if (next === this.lastCircuit) return;
    const prev = this.lastCircuit;
    this.lastCircuit = next;
    if (!prev && next === 'NORMAL') return;
    const daily = this.deps.dailyLossPercent();
    await this.deps.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'SYSTEM',
      severity: next === 'NORMAL' ? 'IMPORTANT' : 'CRITICAL',
      title: 'RISK ALERT',
      body: `Daily drawdown: ${daily.toFixed(2)}%\nDaily limit: ${this.deps.limits.maxDailyLossPercent.toFixed(2)}%\nCircuit breaker: ${next}`,
      fingerprint: 'SYSTEM:circuit',
      stateFrom: prev,
      stateTo: next,
      payload: { circuit: next, dailyLossPercent: daily },
    }));
  }

  private async checkKill(): Promise<void> {
    const halted = this.deps.killSwitch?.halted;
    if (halted === undefined || halted === this.lastKill) return;
    const prev = this.lastKill;
    this.lastKill = halted;
    if (prev === undefined) return;
    await this.deps.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'SYSTEM',
      severity: 'CRITICAL',
      title: halted ? 'KILL SWITCH HALTED' : 'KILL SWITCH RESUMED',
      body: this.deps.killSwitch?.currentReason ?? '',
      fingerprint: 'SYSTEM:killswitch',
      stateFrom: halted ? 'NORMAL' : 'HALTED',
      stateTo: halted ? 'HALTED' : 'NORMAL',
      payload: {},
    }));
  }

  private async checkAudit(): Promise<void> {
    const ok = this.deps.store.healthy;
    if (ok === this.lastStoreOk) return;
    this.lastStoreOk = ok;
    await this.deps.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'SYSTEM',
      severity: ok ? 'IMPORTANT' : 'CRITICAL',
      title: ok ? 'EVENT STORE RECOVERED' : 'EVENT STORE UNHEALTHY',
      body: ok ? 'Audit trail writable' : (this.deps.store.lastError ?? 'write failed'),
      fingerprint: 'SYSTEM:event-store',
      stateFrom: ok ? 'UNHEALTHY' : 'HEALTHY',
      stateTo: ok ? 'HEALTHY' : 'UNHEALTHY',
      payload: {},
    }));
  }
}
