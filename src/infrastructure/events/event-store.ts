import fs from 'node:fs';
import path from 'node:path';

/** Append-only JSONL event store — the audit backbone. */
export interface KernelEvent {
  readonly at: number;
  readonly type: string;
  readonly decisionId?: string;
  readonly symbol?: string;
  readonly payload: unknown;
}

export interface EventStoreOptions {
  readonly filePath?: string;
  /**
   * Durability contract. When true (production/live trading), critical
   * events (order lifecycle, reconciliation) MUST reach disk: a write
   * failure flips the store unhealthy and blocks new order submissions
   * instead of silently continuing without an audit trail.
   */
  readonly durable?: boolean;
}

export class EventPersistenceError extends Error {
  constructor(readonly event: KernelEvent, readonly cause: unknown) {
    super(`event store write failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'EventPersistenceError';
  }
}

/** Event types that form the order-audit durability contract. */
const CRITICAL_TYPES = new Set([
  'order.registered',
  'order.transition',
  'order.unknown',
  'reconcile',
  'execution.slippage_breach',
  'position.closed',
]);

export class EventStore {
  private readonly filePath: string;
  private readonly durable: boolean;
  private readonly buffer: KernelEvent[] = [];
  private writeFailures = 0;
  private lastWriteError?: string;

  constructor(filePathOrOpts?: string | EventStoreOptions) {
    const opts: EventStoreOptions =
      typeof filePathOrOpts === 'string' ? { filePath: filePathOrOpts } : filePathOrOpts ?? {};
    const envDurable = process.env.EVENT_STORE_DURABLE === 'true';
    this.durable = opts.durable ?? envDurable;
    this.filePath = opts.filePath ??
      path.join(process.env.EVENT_STORE_PATH ?? '.data', 'kernel-events.jsonl');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /** Health of the durability contract (degraded = disk writes failing). */
  get healthy(): boolean {
    return this.lastWriteError === undefined;
  }

  get writeFailureCount(): number {
    return this.writeFailures;
  }

  get lastError(): string | undefined {
    return this.lastWriteError;
  }

  get isDurable(): boolean {
    return this.durable;
  }

  private write(full: KernelEvent): boolean {
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, 'utf-8');
      this.lastWriteError = undefined;
      return true;
    } catch (err) {
      this.writeFailures++;
      this.lastWriteError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /**
   * Append a non-critical event. Disk failures degrade the store but
   * never break the trading loop (telemetry-style events only).
   */
  append(event: Omit<KernelEvent, 'at'>): KernelEvent {
    const full: KernelEvent = { at: Date.now(), ...event };
    this.buffer.push(full);
    this.write(full);
    return full;
  }

  /**
   * Append a critical event under the durability contract.
   * - durable mode: a write failure throws EventPersistenceError so the
   *   caller can halt the affected order flow (audit trail is mandatory).
   * - non-durable mode (paper/dev): best effort, but still marks health.
   */
  appendCritical(event: Omit<KernelEvent, 'at'>): KernelEvent {
    const full: KernelEvent = { at: Date.now(), ...event };
    this.buffer.push(full);
    const ok = this.write(full);
    if (!ok && this.durable) {
      throw new EventPersistenceError(full, this.lastWriteError);
    }
    return full;
  }

  /** Append with automatic criticality classification. */
  appendClassified(event: Omit<KernelEvent, 'at'>): KernelEvent {
    return CRITICAL_TYPES.has(event.type) ? this.appendCritical(event) : this.append(event);
  }

  tail(limit = 50): readonly KernelEvent[] {
    return this.buffer.slice(-limit);
  }

  readAll(limit = 500): readonly KernelEvent[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const lines = fs.readFileSync(this.filePath, 'utf-8').trim().split('\n');
      return lines.slice(-limit).map((l) => JSON.parse(l) as KernelEvent);
    } catch {
      return [];
    }
  }
}
