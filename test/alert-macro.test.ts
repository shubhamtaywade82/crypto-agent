import { describe, expect, it } from 'vitest';
import { newsFromRss, parseCalendarJson, mapFinnhub } from '../src/engines/alerts/macro-calendar.js';
import { MacroPolicy } from '../src/engines/alerts/macro-policy.js';

describe('macro calendar parsers', () => {
  it('accepts typed JSON events and rejects garbage', () => {
    const ok = parseCalendarJson({
      events: [{ id: 'cpi', name: 'US CPI', at: 1_700_000_000_000, impact: 'HIGH', currencies: ['USD'] }],
    });
    expect(ok).toHaveLength(1);
    expect(parseCalendarJson({ nope: true })).toHaveLength(0);
  });

  it('maps high-impact US Finnhub rows only', () => {
    const rows = mapFinnhub({
      economicCalendar: [
        { event: 'CPI', time: '2026-09-10T12:30:00Z', impact: 'high', country: 'US' },
        { event: 'CPI', time: '2026-09-10T12:30:00Z', impact: 'low', country: 'US' },
        { event: 'GDP', time: '2026-09-10T12:30:00Z', impact: 'high', country: 'EU' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('CPI');
  });

  it('filters RSS to high-impact keywords', () => {
    const xml = `<rss><channel>
      <item><title>US CPI surprises to the upside</title><guid>1</guid></item>
      <item><title>Sports scores tonight</title><guid>2</guid></item>
    </channel></rss>`;
    const news = newsFromRss(xml);
    expect(news).toHaveLength(1);
    expect(news[0]?.title).toContain('CPI');
  });
});

describe('MacroPolicy', () => {
  it('blocks new risk at VERY_HIGH', () => {
    const p = new MacroPolicy();
    p.set('VERY_HIGH', 'US CPI');
    expect(p.risk()).toBe('VERY_HIGH');
    expect(p.note()).toContain('US CPI');
    p.set('NONE');
    expect(p.note()).toBeUndefined();
  });
});
