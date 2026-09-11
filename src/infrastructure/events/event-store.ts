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

const BUFFER_CAP = 5000;

const parseLine = (line: string): KernelEvent | undefined => {
  try {
    return JSON.parse(line) as KernelEvent;
  } catch {
    return undefined;
  }
};

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

  private trimBuffer(): void {
    if (this.buffer.length > BUFFER_CAP) {
      this.buffer.splice(0, this.buffer.length - BUFFER_CAP);
    }
  }

  private push(full: KernelEvent): void {
    this.buffer.push(full);
    this.trimBuffer();
  }

  private parseTailLines(lines: string[], limit: number): KernelEvent[] {
    return lines.slice(-limit).map(parseLine).filter((e): e is KernelEvent => e !== undefined);
  }

  private readChunkLines(start: number, chunkSize: number): string[] {
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(this.filePath, 'r');
    fs.readSync(fd, buf, 0, chunkSize, start);
    fs.closeSync(fd);
    let text = buf.toString('utf-8');
    if (start > 0) {
      const firstNl = text.indexOf('\n');
      if (firstNl >= 0) text = text.slice(firstNl + 1);
    }
    return text.trim().split('\n').filter(Boolean);
  }

  /**
   * Read the last N JSONL records without loading the full audit file.
   * Critical for long-running TUI sessions where the log grows to 100k+ lines.
   */
  private readFileTail(limit: number): KernelEvent[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const stat = fs.statSync(this.filePath);
      if (stat.size === 0) return [];
      let chunkSize = Math.min(stat.size, Math.max(65_536, limit * 512));
      while (chunkSize <= stat.size) {
        const lines = this.readChunkLines(stat.size - chunkSize, chunkSize);
        if (lines.length >= limit || chunkSize >= stat.size) return this.parseTailLines(lines, limit);
        chunkSize = Math.min(stat.size, chunkSize * 2);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Append a non-critical event. Disk failures degrade the store but
   * never break the trading loop (telemetry-style events only).
   */
  append(event: Omit<KernelEvent, 'at'>): KernelEvent {
    const full: KernelEvent = { at: Date.now(), ...event };
    this.push(full);
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
    this.push(full);
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
    return this.readAll(limit);
  }

  readAll(limit = 500): readonly KernelEvent[] {
    if (!fs.existsSync(this.filePath)) return this.buffer.slice(-limit);
    return this.readFileTail(limit);
  }
}
