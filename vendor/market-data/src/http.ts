/**
 * Minimal HTTP fetch wrapper with retry/backoff for transient transport
 * errors. Deliberately dependency-free (uses Node 20+ global fetch).
 *
 * Non-goals: this is NOT a full HTTP client. It does one thing — GET JSON
 * with timeout, retry, and abort support — and is intentionally typed so
 * adapters own their response-shape parsing.
 */

export interface HttpGetOptions {
  readonly url: string;
  readonly headers?: Record<string, string> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryBackoffMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class HttpTransientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpTransientError';
  }
}

export class HttpFatalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpFatalError';
  }
}

/**
 * Perform a GET request, retrying on transient failures (network errors,
 * 429, 5xx). Returns parsed JSON. Throws {@link HttpFatalError} on 4xx
 * (non-429) and {@link HttpTransientError} if retries are exhausted.
 */
export async function httpGetJson<T>(opts: HttpGetOptions): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseBackoff = opts.retryBackoffMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw new HttpTransientError('Aborted', undefined);
    }

    // Compose timeout + external abort into a single controller.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const composedSignal = composeSignals(
      opts.signal,
      timeoutController.signal,
    );

    try {
      const res = await fetch(opts.url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
        signal: composedSignal,
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      // 429 and 5xx are retryable.
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));

      if (!retryable) {
        const body = await res.text().catch(() => '');
        throw new HttpFatalError(
          `HTTP ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
          res.status,
        );
      }

      lastError = new HttpTransientError(
        `HTTP ${res.status} ${res.statusText}`,
        res.status,
        retryAfter,
      );
    } catch (err) {
      if (err instanceof HttpFatalError) throw err;
      // AbortError from timeout or external signal is retryable if external.
      if (err instanceof Error && err.name === 'AbortError') {
        if (opts.signal?.aborted) {
          throw new HttpTransientError('External abort', undefined);
        }
        // Timeout — retryable.
        lastError = new HttpTransientError('Request timeout', undefined);
      } else if (err instanceof HttpTransientError) {
        lastError = err;
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < maxRetries) {
      const delay =
        lastError instanceof HttpTransientError
          ? (lastError.retryAfterMs ?? baseBackoff * Math.pow(2, attempt))
          : baseBackoff * Math.pow(2, attempt);
      await sleep(Math.min(delay, 30_000), opts.signal);
    }
  }

  throw (
    lastError ??
    new HttpTransientError('Retries exhausted without specific error')
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date - Date.now() : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new HttpTransientError('Aborted during backoff', undefined));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new HttpTransientError('Aborted during backoff', undefined));
      },
      { once: true },
    );
  });
}

function composeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
