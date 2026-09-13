import { describe, expect, it } from 'vitest';
import { toLtpTableRow } from '../src/ui/components/LiveLtpTable.js';
import { toMarketTableRow, toOpportunityTableRow } from '../src/ui/components/OpportunityTable.js';
import type { MonitoredMarket, ScanOpportunity } from '../src/ui/scan-opportunities.js';

const quote = (partial: Partial<{ ltp: number; bid: number; ask: number; mark: number; live: boolean }>) => ({
  live: false,
  ...partial,
});

const market = (partial: Partial<MonitoredMarket> = {}): MonitoredMarket => ({
  symbol: 'SOLUSDT',
  price: 101.26,
  regime: 'COMPRESSION',
  trend: 'RANGING',
  scannedAt: '12:00:00',
  setupsCount: 0,
  ...partial,
});

const opp = (partial: Partial<ScanOpportunity> = {}): ScanOpportunity => ({
  symbol: 'ETHUSDT',
  setup: 'Pullback Reclaim',
  direction: 'LONG',
  tf: '1h',
  confidence: 0.81,
  regime: 'TREND_UP',
  rr: 2.8,
  state: 'READY',
  thesis: 'reclaim',
  mtf: '4H↑ 1H↑',
  scannedAt: '12:00:00',
  ...partial,
});

describe('toLtpTableRow', () => {
  it('marks ANCHOR even when the quote is live', () => {
    const row = toLtpTableRow('BTCUSDT', quote({ ltp: 77130, live: true }), true);
    expect(row).toMatchObject({ symbol: 'BTCUSDT', status: 'ANCHOR' });
    expect(row.ltp).toContain('77,130');
  });

  it('marks LIVE, STALE, and WAIT from quote freshness', () => {
    expect(toLtpTableRow('SOLUSDT', quote({ ltp: 101.26, live: true }), false).status).toBe('LIVE');
    expect(toLtpTableRow('SOLUSDT', quote({ ltp: 101.26, live: false }), false).status).toBe('STALE');
    expect(toLtpTableRow('SOLUSDT', quote({ live: false }), false).status).toBe('WAIT');
    expect(toLtpTableRow('SOLUSDT', quote({ live: false }), false).ltp).toBe('—');
  });
});

describe('toMarketTableRow', () => {
  it('uses live LTP and compact symbol/regime/trend', () => {
    const row = toMarketTableRow(market(), 0, true, quote({ ltp: 101.26, live: true }));
    expect(row).toEqual({
      n: '1',
      symbol: 'SOL',
      ltp: '$101.26',
      regime: 'COMPRES',
      trend: 'RANG',
    });
    expect(row).not.toHaveProperty('setups');
  });

  it('full rows keep setups/status and tag stale LTP', () => {
    const row = toMarketTableRow(market({ symbol: 'ETHUSDT' }), 1, false, quote({ ltp: 2513.58, live: false }));
    expect(row.n).toBe('2');
    expect(row.symbol).toBe('ETHUSDT');
    expect(row.ltp).toBe('$2,513.58*');
    expect(row.regime).toBe('COMPRESSION');
    expect(row.trend).toBe('RANGING');
    expect(row.setups).toBe('0');
    expect(row.status).toBe('MONITORING');
  });
});

describe('toOpportunityTableRow', () => {
  it('compact rows keep #, symbol, setup, rr, state', () => {
    const row = toOpportunityTableRow(opp(), 0, true);
    expect(row).toEqual({
      n: '1',
      symbol: 'ETH',
      setup: 'Pullback Reclaim',
      rr: '2.8',
      state: 'READY',
    });
  });

  it('full rows include direction, tf, confidence, and regime', () => {
    const row = toOpportunityTableRow(opp({ direction: 'SHORT', state: 'WATCH' }), 2, false);
    expect(row.n).toBe('3');
    expect(row.symbol).toBe('ETHUSDT');
    expect(row.direction).toBe('SHORT');
    expect(row.tf).toBe('1h');
    expect(row.conf).toBe('0.81');
    expect(row.regime).toBe('TREND_UP');
    expect(row.state).toBe('WATCH');
  });
});
