import { describe, it, expect } from 'vitest';
import {
  buildCrossVenueState, crossVenueExecutionRisk, quoteHealth,
  type VenueQuote,
} from '../src/domain/market/cross-venue.js';

const now = 1_700_000_000_000;
const binance: VenueQuote = { venue: 'BINANCE', bid: 99.9, ask: 100.1, last: 100, at: now };
const coindcxUsdt: VenueQuote = { venue: 'COINDCX', bid: 99.8, ask: 100.4, last: 100.1, at: now };

describe('CrossVenueState — two-venue awareness', () => {
  it('computes basis and spreads in bps for USDT-margined pairs', () => {
    const s = buildCrossVenueState(binance, coindcxUsdt, 1, now);
    expect(s.coindcxMidUsdt).toBeCloseTo(100.1, 6);
    expect(s.basis).toBeCloseTo(100.1 - 100, 6);
    expect(s.basisBps).toBeCloseTo(10, 4);
    expect(s.coindcxSpreadBps).toBeCloseTo(59.94, 2);
    expect(s.binanceSpreadBps).toBeCloseTo(20, 4);
    expect(s.health).toBe('OK');
  });

  it('normalizes INR quotes through the live FX rate', () => {
    const coindcxInr: VenueQuote = {
      venue: 'COINDCX', bid: 8_780, ask: 8_840, last: 8_810, at: now,
    };
    const s = buildCrossVenueState(binance, coindcxInr, 88, now);
    expect(s.coindcxMidUsdt).toBeCloseTo(8_810 / 88, 6);
    expect(s.basisBps).toBeLessThan(50); // near parity after FX normalization
  });

  it('treats a missing execution-venue quote as an incomplete picture', () => {
    const s = buildCrossVenueState(binance, undefined, 1, now);
    // The reference leg is fine, but without the venue quote the
    // cross-venue picture is UNAVAILABLE and must not gate trades as OK.
    expect(s.health).toBe('UNAVAILABLE');
    expect(s.basisBps).toBeUndefined();
  });

  it('flags stale quotes', () => {
    const stale = { ...binance, at: now - 60_000 };
    expect(quoteHealth(stale, now)).toBe('STALE');
    const s = buildCrossVenueState(stale, coindcxUsdt, 1, now);
    expect(s.health).toBe('STALE');
  });

  it('gates execution on basis and spread limits', () => {
    const wide = { ...coindcxUsdt, bid: 98, ask: 103 }; // ~500bps spread
    const s = buildCrossVenueState(binance, wide, 1, now);
    const risk = crossVenueExecutionRisk(s, 50, 30);
    expect(risk.tradable).toBe(false);
    expect(risk.reasons.join(' ')).toContain('spread');

    const fine = buildCrossVenueState(binance, coindcxUsdt, 1, now);
    expect(crossVenueExecutionRisk(fine, 50, 100).tradable).toBe(true);
  });

  it('gates execution on unnormalized basis', () => {
    const rich: VenueQuote = { venue: 'COINDCX', bid: 101.5, ask: 101.7, last: 101.6, at: now };
    const s = buildCrossVenueState(binance, rich, 1, now);
    const risk = crossVenueExecutionRisk(s, 50, 500);
    expect(risk.tradable).toBe(false);
    expect(risk.reasons.join(' ')).toContain('basis');
  });
});
