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

export class EventStore {
  private readonly filePath: string;
  private readonly buffer: KernelEvent[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ??
      path.join(process.env.EVENT_STORE_PATH ?? '.data', 'kernel-events.jsonl');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  append(event: Omit<KernelEvent, 'at'>): KernelEvent {
    const full: KernelEvent = { at: Date.now(), ...event };
    this.buffer.push(full);
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, 'utf-8');
    } catch {
      /* disk failures must never break the trading loop */
    }
    return full;
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
