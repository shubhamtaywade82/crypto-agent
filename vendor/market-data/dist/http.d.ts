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
export declare class HttpTransientError extends Error {
    readonly status?: number | undefined;
    readonly retryAfterMs?: number | undefined;
    constructor(message: string, status?: number | undefined, retryAfterMs?: number | undefined);
}
export declare class HttpFatalError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
/**
 * Perform a GET request, retrying on transient failures (network errors,
 * 429, 5xx). Returns parsed JSON. Throws {@link HttpFatalError} on 4xx
 * (non-429) and {@link HttpTransientError} if retries are exhausted.
 */
export declare function httpGetJson<T>(opts: HttpGetOptions): Promise<T>;
//# sourceMappingURL=http.d.ts.map