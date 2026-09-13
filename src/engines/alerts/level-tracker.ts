import type { MarketState } from '../../domain/market/types.js';
import type { MiFreshEvent } from '../mi-event-scan.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';

export const LEVEL_ENTER_PCT = 0.15;
export const LEVEL_EXIT_PCT = 0.40;
export const LEVEL_REACH_PCT = 0.02;

export type LevelBand = 'FAR' | 'APPROACHING' | 'REACHED';

export const distancePct = (price: number, level: number): number => {
  if (price <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(price - level) / price * 100;
};

export const nextBand = (dist: number, prev: LevelBand): LevelBand => {
  if (dist <= LEVEL_REACH_PCT) return 'REACHED';
  if (prev === 'FAR') return dist <= LEVEL_ENTER_PCT ? 'APPROACHING' : 'FAR';
  if (prev === 'APPROACHING') {
    if (dist > LEVEL_EXIT_PCT) return 'FAR';
    return dist <= LEVEL_REACH_PCT ? 'REACHED' : 'APPROACHING';
  }
  if (dist > LEVEL_EXIT_PCT) return 'FAR';
  if (dist > LEVEL_ENTER_PCT) return 'APPROACHING';
  return 'REACHED';
};

interface TrackedLevel {
  readonly kind: 'support' | 'resistance';
  readonly price: number;
  band: LevelBand;
}

export type BreakoutPhase = 'NONE' | 'WATCH' | 'CONFIRMED' | 'FAILED';

export const inferBreakout = (args: {
  readonly price: number;
  readonly close: number;
  readonly level: number;
  readonly bos: boolean;
  readonly prev: BreakoutPhase;
}): BreakoutPhase => {
  const { price, close, level, bos, prev } = args;
  if (!Number.isFinite(level) || level <= 0) return 'NONE';
  if (close > level) return 'CONFIRMED';
  if (prev === 'WATCH' && price < level && close < level) return 'FAILED';
  if (bos && distancePct(price, level) <= LEVEL_ENTER_PCT) return 'WATCH';
  return prev === 'CONFIRMED' || prev === 'FAILED' ? prev : 'NONE';
};

const bucket = (price: number): string => price.toFixed(2);

export class LevelTracker {
  private readonly levels = new Map<string, TrackedLevel>();
  private readonly breakouts = new Map<string, BreakoutPhase>();

  constructor(private readonly dispatcher: AlertDispatcher) {}

  async observe(state: MarketState, mi: readonly MiFreshEvent[] = []): Promise<void> {
    const price = state.price.last;
    await this.track(state, 'resistance', state.liquidity.nearestHigh, price);
    await this.track(state, 'support', state.liquidity.nearestLow, price);
    await this.breakout(state);
    await this.reactions(state, mi);
  }

  private key(symbol: string, kind: string, px: number): string {
    return `${symbol}:${kind}:${bucket(px)}`;
  }

  private async track(
    state: MarketState,
    kind: 'support' | 'resistance',
    level: number,
    price: number
  ): Promise<void> {
    if (!Number.isFinite(level) || level <= 0) return;
    const id = this.key(state.symbol, kind, level);
    const prev = this.levels.get(id)?.band ?? 'FAR';
    const dist = distancePct(price, level);
    const band = nextBand(dist, prev);
    this.levels.set(id, { kind, price: level, band });
    if (band === prev) return;
    if (band === 'FAR') return;
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'LEVEL',
      severity: band === 'REACHED' ? 'IMPORTANT' : 'WATCH',
      symbol: state.symbol,
      title: band === 'REACHED' ? 'LEVEL REACHED' : 'LEVEL APPROACHING',
      body: [
        `Price: ${price.toFixed(2)}`,
        `${kind}: ${level.toFixed(2)}`,
        `Distance: ${dist.toFixed(2)}%`,
        band === 'REACHED' ? 'Waiting for: breakout acceptance OR rejection' : 'Potential: BREAKOUT / REJECTION',
      ].join('\n'),
      fingerprint: `LEVEL:${id}`,
      stateFrom: prev,
      stateTo: band,
      payload: { kind: band, level, distancePct: dist },
    }));
  }

  private async breakout(state: MarketState): Promise<void> {
    const level = state.liquidity.nearestHigh;
    const id = `${state.symbol}:bo:${bucket(level)}`;
    const prev = this.breakouts.get(id) ?? 'NONE';
    const next = inferBreakout({
      price: state.price.last,
      close: state.timeframes['5m'].lastClose,
      level,
      bos: state.timeframes['5m'].structure.bos,
      prev,
    });
    this.breakouts.set(id, next);
    if (next === prev || next === 'NONE') return;
    const title = next === 'WATCH' ? 'BREAKOUT WATCH' : next === 'CONFIRMED' ? 'BREAKOUT CONFIRMED' : 'FAILED BREAKOUT';
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'LEVEL',
      severity: next === 'WATCH' ? 'WATCH' : 'IMPORTANT',
      symbol: state.symbol,
      title,
      body: `Level: ${level.toFixed(2)}\nPrice: ${state.price.last.toFixed(2)}\n5M close: ${state.timeframes['5m'].lastClose.toFixed(2)}`,
      fingerprint: `LEVEL:${id}:breakout`,
      stateFrom: prev,
      stateTo: next,
      payload: { kind: next, level },
    }));
  }

  private async reactions(state: MarketState, mi: readonly MiFreshEvent[]): Promise<void> {
    const sweep = mi.find((e) => e.eventType === 'liquidity_sweep');
    const choch = mi.find((e) => e.eventType === 'choch');
    if (!sweep && !state.liquidity.sweepDetected && !choch) return;
    const near = [...this.levels.entries()].find(([, v]) => v.band === 'REACHED' || v.band === 'APPROACHING');
    if (!near) return;
    const [id, lvl] = near;
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'LEVEL',
      severity: 'IMPORTANT',
      symbol: state.symbol,
      title: 'LEVEL REACTION',
      body: [
        `Zone: ${lvl.kind} ${lvl.price.toFixed(2)}`,
        sweep ? `Reaction: ${sweep.label}` : `Sweep: ${state.liquidity.sweepSide}`,
        choch ? choch.label : '',
      ].filter(Boolean).join('\n'),
      fingerprint: `LEVEL:${id}:reaction`,
      stateTo: 'REACTION',
      payload: { sweep: sweep?.label, choch: choch?.label },
    }));
  }
}
