import type { BaseEvent } from '@nemesis-oss/market-events';
/**
 * A node in the event graph: one detected event at a point in time.
 */
export interface EventNode {
    readonly eventId: string;
    readonly eventType: string;
    readonly symbol: string;
    readonly timeframe: string;
    readonly direction: 'bullish' | 'bearish';
    readonly availableAtIndex: number;
    readonly availableAtTimestamp: number;
}
/**
 * A directed edge: event A → event B, meaning B followed A within
 * `maxBarGap` candles. Edges are typed by the transition (e.g. "fvg→sweep").
 */
export interface EventEdge {
    readonly from: EventNode;
    readonly to: EventNode;
    readonly barGap: number;
    readonly transition: string;
}
/**
 * A graph of events for a single symbol+timeframe dataset.
 */
export interface EventGraph {
    readonly symbol: string;
    readonly timeframe: string;
    readonly nodes: readonly EventNode[];
    readonly edges: readonly EventEdge[];
    /** Adjacency list: eventId → outgoing edges. */
    readonly adjacency: ReadonlyMap<string, readonly EventEdge[]>;
}
/**
 * A discovered composite pattern: a sequence of event types that
 * co-occur within temporal proximity more often than expected by chance.
 *
 * Example: "fvg → liquidity_sweep → mss" with support=42 means this
 * exact sequence was detected 42 times in the dataset.
 */
export interface CompositePattern {
    readonly sequence: readonly string[];
    readonly support: number;
    readonly avgBarGap: number;
    readonly examples: readonly EventEdge[];
}
export interface EventGraphOptions {
    readonly maxBarGap?: number;
    readonly requireDirectionMatch?: boolean;
}
/**
 * Build an event graph from a set of events of different types.
 *
 * Nodes are events; edges connect event A to event B if B's availableAtIndex
 * is within `maxBarGap` candles after A's availableAtIndex.
 */
export declare function buildEventGraph(eventsByType: ReadonlyMap<string, readonly BaseEvent[]>, symbol: string, timeframe: string, options?: EventGraphOptions): EventGraph;
/**
 * Discover composite patterns of length 2–3 in the event graph.
 *
 * A pattern of length 2 is just an edge transition ("fvg→sweep").
 * A pattern of length 3 is a two-hop path ("fvg→sweep→mss").
 *
 * Returns patterns sorted by support (frequency) descending.
 */
export declare function discoverPatterns(graph: EventGraph, minLength?: number, maxLength?: number): readonly CompositePattern[];
//# sourceMappingURL=graph.d.ts.map