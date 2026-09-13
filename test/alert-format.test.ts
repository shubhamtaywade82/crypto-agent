import { describe, expect, it } from 'vitest';
import { formatAlertHtml } from '../src/notifications/alert-telegram.js';
import { makeAlert } from '../src/engines/alerts/make-alert.js';

describe('formatAlertHtml', () => {
  it('tags compact SIGNAL cards', () => {
    const html = formatAlertHtml(makeAlert({
      at: 1,
      class: 'SIGNAL',
      severity: 'SIGNAL',
      symbol: 'SOLUSDT',
      title: 'TRADE SIGNAL — SOLUSDT LONG',
      body: '101.75–101.90\nRR 2.5+ · 87%',
      fingerprint: 'SIGNAL:SOLUSDT:long',
      stateTo: 'CONFIRMED',
      payload: { confidence: 0.87, rr: 2.6 },
    }));
    expect(html).toContain('[ SIGNAL ]');
    expect(html).toContain('SOLUSDT');
    expect(html).toContain('101.75');
  });
});
