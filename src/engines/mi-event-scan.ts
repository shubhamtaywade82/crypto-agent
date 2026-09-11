import {
  detectChoch,
  detectLiquiditySweeps,
  detectSwings,
  validateEventCausality,
  type LiquiditySweepEvent,
  type StructureBreakEvent,
} from '@nemesis-oss/market-events';
import type { Candle, Timeframe } from '../domain/market/types.js';
import { toMiCandles, toMiTimeframe } from './mi-candle-adapter.js';

export type MiEventKind = 'choch' | 'liquidity_sweep';

export interface MiFreshEvent {
  readonly eventType: MiEventKind;
  readonly eventId: string;
  readonly direction: string;
  readonly label: string;
}

const MIN_BARS = 20;

const chochLabel = (e: StructureBreakEvent): string =>
  `${e.direction} CHoCH break @ ${e.breakPrice.toFixed(2)}`;

const sweepLabel = (e: LiquiditySweepEvent): string =>
  `${e.direction} ${e.targetType} sweep @ ${e.sweptLevel.toFixed(2)}` +
  ` (reclaimed=${e.reclaimed})`;

const freshOnBar = (availableAtIndex: number, closeIndex: number): boolean =>
  availableAtIndex === closeIndex;

const toFresh = (
  eventType: MiEventKind,
  id: string,
  direction: string,
  label: string
): MiFreshEvent => ({ eventType, eventId: id, direction, label });

/** Events from market-intelligence that became observable on the latest closed bar. */
export const scanMiEventsOnClose = (
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
  seenIds: ReadonlySet<string>
): MiFreshEvent[] => {
  if (candles.length < MIN_BARS) return [];
  const miCandles = toMiCandles(candles);
  const closeIndex = miCandles.length - 1;
  const miTf = toMiTimeframe(timeframe);
  // Minor swings (1+1) align with market-intelligence causal sweep/CHoCH fixtures.
  const swings = detectSwings(miCandles, { leftBars: 1, rightBars: 1, strength: 'minor' });
  const opts = { symbol, timeframe: miTf };

  const chochs = detectChoch(miCandles, swings, opts)
    .filter((e) => freshOnBar(e.availableAtIndex, closeIndex) && !seenIds.has(e.id));
  const sweeps = detectLiquiditySweeps(miCandles, swings, opts)
    .filter((e) => freshOnBar(e.availableAtIndex, closeIndex) && !seenIds.has(e.id));

  for (const ev of [...chochs, ...sweeps]) validateEventCausality(ev);

  return [
    ...chochs.map((e) => toFresh('choch', e.id, e.direction, chochLabel(e))),
    ...sweeps.map((e) => toFresh('liquidity_sweep', e.id, e.direction, sweepLabel(e))),
  ];
};
