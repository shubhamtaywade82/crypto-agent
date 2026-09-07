/**
 * Per-symbol serialized lanes replacing the global `processing` boolean.
 * Events for one symbol process in order; different symbols run in
 * parallel. Portfolio-critical work can use the global lane.
 */
export class SymbolLanes {
  private readonly chains = new Map<string, Promise<void>>();
  private globalChain: Promise<void> = Promise.resolve();

  /** Enqueue ordered work for one symbol lane. */
  enqueue<T>(symbol: string, task: () => Promise<T>): Promise<T> {
    const key = symbol.toUpperCase();
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.chains.set(key, next.then(() => undefined, () => undefined));
    return next;
  }

  /** Enqueue work that must be globally serialized (e.g. portfolio mutation). */
  enqueueGlobal<T>(task: () => Promise<T>): Promise<T> {
    const next = this.globalChain.then(task, task);
    this.globalChain = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Number of lanes with pending work. */
  laneCount(): number {
    return this.chains.size;
  }

  /** Await completion of all lanes (used in tests/shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values(), this.globalChain]);
  }
}
