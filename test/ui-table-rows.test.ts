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
      setup: 'Pullback R',
      rr: '2.8',
      state: 'READY',
    });
  });

  it('compact rows map REJECTED to REJECT rather than REJECTE', () => {
    const row = toOpportunityTableRow(opp({ state: 'REJECTED' }), 0, true);
    expect(row.state).toBe('REJECT');
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

describe('fitCols and dividerLine', () => {
  it('shrinks by the shell gutter so a full-width rule does not wrap', async () => {
    const { fitCols, dividerLine } = await import('../src/components/ui/divider/index.js');
    expect(fitCols(80)).toBe(78);
    expect(fitCols(80, 34)).toBe(34);
    const line = dividerLine('─', 78);
    expect(line).toHaveLength(78);
    expect(line.startsWith('──')).toBe(true);
  });
});

describe('formatPrecision and fmtPrice precision retention', () => {
  it('maintains explicit decimal precision for numeric inputs even when integer', async () => {
    const { formatPrecision } = await import('../src/domain/primitives.js');
    expect(formatPrecision(6, 1)).toBe('6.0');
    expect(formatPrecision(6, 2)).toBe('6.00');
    expect(formatPrecision(6, 3)).toBe('6.000');
    expect(formatPrecision(6, 4)).toBe('6.0000');
  });

  it('preserves decimals from string representation', async () => {
    const { formatPrecision } = await import('../src/domain/primitives.js');
    expect(formatPrecision('6.0')).toBe('6.0');
    expect(formatPrecision('6.000')).toBe('6.000');
    expect(formatPrecision('0.00')).toBe('0.00');
    expect(formatPrecision('0.0000')).toBe('0.0000');
  });

  it('formats by symbol tick precision without dropping decimals', async () => {
    const { fmtPrice } = await import('../src/ui/KernelDashboard.js');
    expect(fmtPrice(6, 'BTCUSDT')).toBe('6.0');
    expect(fmtPrice(6, 'SOLUSDT')).toBe('6.00');
    expect(fmtPrice(6, 'NEARUSDT')).toBe('6.000');
    expect(fmtPrice(6, 'XRPUSDT')).toBe('6.0000');
    expect(fmtPrice(77130, 'BTCUSDT')).toBe('77,130.0');
    expect(fmtPrice(101.2, 'SOLUSDT')).toBe('101.20');
    expect(fmtPrice(0.5, 'XRPUSDT')).toBe('0.5000');
  });

  it('keeps symbol precision in toLtpTableRow cells', () => {
    const row = toLtpTableRow('XRPUSDT', quote({ ltp: 0.5, bid: 0.49, ask: 0.51, mark: 0.5, live: true }), false);
    expect(row.ltp).toBe('$0.5000');
    expect(row.bid).toBe('$0.4900');
    expect(row.ask).toBe('$0.5100');
    expect(row.mark).toBe('$0.5000');
  });

  it('calculates computeScrollY correctly for viewport scrolling', async () => {
    const { computeScrollY } = await import('../src/ui/views/OverviewView.js');
    // Fits completely
    expect(computeScrollY(0, 50)).toEqual({ scrollY: 0, maxScroll: 0, maxIdx: 0 });
    // Viewport height 20 -> maxScroll = 12, step = 3
    const s0 = computeScrollY(0, 20);
    expect(s0.scrollY).toBe(0);
    expect(s0.maxScroll).toBe(12);
    expect(s0.maxIdx).toBe(4);

    const s1 = computeScrollY(1, 20);
    expect(s1.scrollY).toBe(3);

    const s3 = computeScrollY(3, 20);
    expect(s3.scrollY).toBe(9);

    // Clamps at maxScroll
    const s10 = computeScrollY(10, 20);
    expect(s10.scrollY).toBe(12);

    // Negative index clamped
    const sNeg = computeScrollY(-2, 20);
    expect(sNeg.scrollY).toBe(0);
  });
});
