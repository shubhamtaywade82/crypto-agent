import type { MarketState } from '../../domain/market/types.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';

const VOL_EXPAND = 80;

export class MarketTracker {
  private readonly regime = new Map<string, string>();
  private readonly btcRegime = new Map<string, string>();
  private readonly volHi = new Map<string, boolean>();

  constructor(private readonly dispatcher: AlertDispatcher) {}

  seed(symbol: string, state: MarketState): void {
    this.regime.set(symbol, state.regime);
    this.btcRegime.set(symbol, state.btcRegime);
    this.volHi.set(symbol, state.timeframes['1h'].volatility.atrPercentile >= VOL_EXPAND);
  }

  async observe(state: MarketState): Promise<void> {
    const symbol = state.symbol;
    await this.regimeShift(state);
    await this.volShift(state);
    await this.btcShift(symbol, state.btcRegime);
  }

  private async regimeShift(state: MarketState): Promise<void> {
    const prev = this.regime.get(state.symbol);
    this.regime.set(state.symbol, state.regime);
    if (!prev || prev === state.regime) return;
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'MARKET',
      severity: 'IMPORTANT',
      symbol: state.symbol,
      title: 'MARKET REGIME CHANGE',
      body: `Previous: ${prev}\nNew: ${state.regime}\nBTC: ${state.btcRegime}`,
      fingerprint: `MARKET:${state.symbol}:regime`,
      stateFrom: prev,
      stateTo: state.regime,
      payload: { from: prev, to: state.regime },
    }));
  }

  private async volShift(state: MarketState): Promise<void> {
    const pct = state.timeframes['1h'].volatility.atrPercentile;
    const hi = pct >= VOL_EXPAND;
    const was = this.volHi.get(state.symbol);
    this.volHi.set(state.symbol, hi);
    if (was === undefined || was === hi || !hi) return;
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'MARKET',
      severity: 'IMPORTANT',
      symbol: state.symbol,
      title: 'VOLATILITY EXPANSION',
      body: `ATR percentile: ${pct.toFixed(0)}%\nRegime: ${state.timeframes['1h'].volatility.regime}\nImplication: wider invalidation, reduced size`,
      fingerprint: `MARKET:${state.symbol}:vol`,
      stateFrom: 'NORMAL',
      stateTo: 'EXPANSION',
      payload: { atrPercentile: pct },
    }));
  }

  private async btcShift(symbol: string, btc: string): Promise<void> {
    if (symbol === 'BTCUSDT') return;
    const prev = this.btcRegime.get(symbol);
    this.btcRegime.set(symbol, btc);
    if (!prev || prev === btc) return;
    await this.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'MARKET',
      severity: 'IMPORTANT',
      symbol,
      title: 'BTC REGIME ALERT',
      body: `BTCUSDT: ${prev} → ${btc}\n${symbol} setups may be downgraded`,
      fingerprint: `MARKET:${symbol}:btc`,
      stateFrom: prev,
      stateTo: btc,
      payload: { btcFrom: prev, btcTo: btc },
    }));
  }
}
