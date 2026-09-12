import { Decimal } from 'decimal.js';

/**
 * Convert any value to a form that survives JSON.stringify without losing
 * numeric precision or producing empty objects.
 *
 * `decimal.js` instances have no enumerable own properties, so
 * `JSON.stringify(new Decimal('1.5'))` returns '{}'. The runtime's tool
 * output fencing calls JSON.stringify on tool output, so any Decimal
 * returned from a tool would silently disappear from the model's context.
 *
 * This walker:
 *  - converts Decimal to its full-precision string form (the model can
 *    read it as a number),
 *  - recursively walks plain objects and arrays,
 *  - passes through primitives, null, and undefined unchanged.
 *
 * Use this on every tool output before returning it to the runtime.
 */
export function serializeForTool(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Decimal) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeForTool);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    // Do not transform class instances that are not plain objects - their
    // own toJSON() implementations should win. Decimal is handled above;
    // any other class with Decimal fields will be recursed into.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeForTool(v);
    }
    return out;
  }

  return value;
}

/**
 * Truncate a serialised tool result body so it fits inside the runtime's
 * SMART_LIMIT_BYTES (48_000) budget. Used by the reflect hook on tools
 * that can return large arrays (event detectors, study results).
 */
export function clampToolOutput<T>(value: T, maxChars = 44_000): T {
  const json = JSON.stringify(value);
  if (json.length <= maxChars) {
    return value;
  }
  return {
    __truncated: true,
    originalSizeChars: json.length,
    maxChars,
    note: 'Full result exceeded the model context budget. Narrow the query (narrower time range, smaller horizon, single event type) and re-run.',
    preview: json.slice(0, maxChars),
  } as unknown as T;
}
