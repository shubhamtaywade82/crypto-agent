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
export declare function serializeForTool(value: unknown): unknown;
/**
 * Truncate a serialised tool result body so it fits inside the runtime's
 * SMART_LIMIT_BYTES (48_000) budget. Used by the reflect hook on tools
 * that can return large arrays (event detectors, study results).
 */
export declare function clampToolOutput<T>(value: T, maxChars?: number): T;
//# sourceMappingURL=serialize.d.ts.map