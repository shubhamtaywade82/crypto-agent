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
  readonly transition: string; // "fvg→sweep"
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
export function buildEventGraph(
  eventsByType: ReadonlyMap<string, readonly BaseEvent[]>,
  symbol: string,
  timeframe: string,
  options: EventGraphOptions = {},
): EventGraph {
  const maxBarGap = options.maxBarGap ?? 3;
  const requireDirectionMatch = options.requireDirectionMatch ?? false;

  // Flatten all events into nodes.
  const nodes: EventNode[] = [];
  for (const [eventType, events] of eventsByType) {
    for (const ev of events) {
      nodes.push({
        eventId: ev.id,
        eventType,
        symbol: ev.symbol,
        timeframe: ev.timeframe,
        direction: ev.direction,
        availableAtIndex: ev.availableAtIndex,
        availableAtTimestamp: ev.availableAtTimestamp,
      });
    }
  }

  // Sort nodes by availableAtIndex ascending.
  nodes.sort((a, b) => a.availableAtIndex - b.availableAtIndex);

  // Build edges: for each node, find subsequent nodes within maxBarGap.
  const edges: EventEdge[] = [];
  const adjacency = new Map<string, EventEdge[]>();

  for (let i = 0; i < nodes.length; i++) {
    const from = nodes[i]!;
    const outEdges: EventEdge[] = [];
    for (let j = i + 1; j < nodes.length; j++) {
      const to = nodes[j]!;
      const barGap = to.availableAtIndex - from.availableAtIndex;
      if (barGap <= 0) continue;
      if (barGap > maxBarGap) break; // sorted, so no more within gap
      if (requireDirectionMatch && from.direction !== to.direction) continue;
      const edge: EventEdge = {
        from,
        to,
        barGap,
        transition: `${from.eventType}→${to.eventType}`,
      };
      edges.push(edge);
      outEdges.push(edge);
    }
    if (outEdges.length > 0) {
      adjacency.set(from.eventId, outEdges);
    }
  }

  return { symbol, timeframe, nodes, edges, adjacency };
}

/**
 * Discover composite patterns of length 2–3 in the event graph.
 *
 * A pattern of length 2 is just an edge transition ("fvg→sweep").
 * A pattern of length 3 is a two-hop path ("fvg→sweep→mss").
 *
 * Returns patterns sorted by support (frequency) descending.
 */
export function discoverPatterns(
  graph: EventGraph,
  minLength = 2,
  maxLength = 3,
): readonly CompositePattern[] {
  const patterns = new Map<string, CompositePattern>();

  // Length-2 patterns: direct edges.
  if (minLength <= 2) {
    const byTransition = new Map<string, EventEdge[]>();
    for (const edge of graph.edges) {
      const list = byTransition.get(edge.transition) ?? [];
      list.push(edge);
      byTransition.set(edge.transition, list);
    }
    for (const [transition, examples] of byTransition) {
      const support = examples.length;
      const avgBarGap =
        examples.reduce((sum, e) => sum + e.barGap, 0) / support;
      patterns.set(transition, {
        sequence: transition.split('→'),
        support,
        avgBarGap,
        examples,
      });
    }
  }

  // Length-3 patterns: two-hop paths.
  if (maxLength >= 3) {
    for (const [, outEdges] of graph.adjacency) {
      for (const edge1 of outEdges) {
        const nextEdges = graph.adjacency.get(edge1.to.eventId) ?? [];
        for (const edge2 of nextEdges) {
          const seq = `${edge1.from.eventType}→${edge1.to.eventType}→${edge2.to.eventType}`;
          const existing = patterns.get(seq);
          if (existing) {
            // Already counted; we don't accumulate examples for length-3
            // to bound memory.
          } else {
            patterns.set(seq, {
              sequence: seq.split('→'),
              support: 0, // will count below
              avgBarGap: 0,
              examples: [],
            });
          }
          const p = patterns.get(seq)!;
          (p as { support: number }).support++;
        }
      }
    }
    // Compute avgBarGap for length-3 patterns.
    for (const p of patterns.values()) {
      if (p.sequence.length === 3 && p.support > 0) {
        // Avg bar gap is not tracked for length-3; leave as 0.
      }
    }
  }

  return Array.from(patterns.values())
    .filter((p) => p.support > 0)
    .sort((a, b) => b.support - a.support);
}
