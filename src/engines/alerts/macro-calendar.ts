import { z } from 'zod';

export const CalendarItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  at: z.number(),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  currencies: z.array(z.string()).default([]),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

export const CalendarListSchema = z.array(CalendarItemSchema);

export const NewsItemSchema = z.object({
  id: z.string(),
  at: z.number(),
  title: z.string(),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

const NEWS_KEYS = /CPI|FOMC|NFP|Powell|Fed\b|inflation|nonfarm/i;

export const defaultCalendar = (): CalendarItem[] => [
  { id: 'fomc-2026-09-16', name: 'FOMC', at: Date.parse('2026-09-16T18:00:00Z'), impact: 'HIGH', currencies: ['USD'] },
  { id: 'cpi-2026-09-10', name: 'US CPI', at: Date.parse('2026-09-10T12:30:00Z'), impact: 'HIGH', currencies: ['USD'] },
  { id: 'nfp-2026-10-02', name: 'US NFP', at: Date.parse('2026-10-02T12:30:00Z'), impact: 'HIGH', currencies: ['USD'] },
];

export const parseCalendarJson = (raw: unknown): CalendarItem[] => {
  const data = Array.isArray(raw) ? raw : (raw as { events?: unknown }).events;
  const parsed = CalendarListSchema.safeParse(data);
  return parsed.success ? parsed.data : [];
};

export const parseNewsJson = (raw: unknown): NewsItem[] => {
  const list = Array.isArray(raw) ? raw : (raw as { headlines?: unknown }).headlines;
  if (!Array.isArray(list)) return [];
  const out: NewsItem[] = [];
  for (const row of list) {
    const p = NewsItemSchema.safeParse(row);
    if (p.success) out.push(p.data);
  }
  return out;
};

export const newsFromRss = (xml: string): NewsItem[] => {
  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const title = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i.exec(block)?.[1]?.trim();
    if (!title || !NEWS_KEYS.test(title)) continue;
    const guid = /<guid[^>]*>([^<]+)<\/guid>/i.exec(block)?.[1] ?? title;
    items.push({ id: guid, at: Date.now(), title, impact: 'HIGH' });
  }
  return items;
};

export const mapFinnhub = (raw: unknown): CalendarItem[] => {
  const rows = (raw as { economicCalendar?: unknown[] }).economicCalendar;
  if (!Array.isArray(rows)) return [];
  const out: CalendarItem[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const impact = String(r.impact ?? '').toLowerCase();
    if (impact !== 'high') continue;
    const country = String(r.country ?? '');
    if (country && country !== 'US') continue;
    const date = String(r.time ?? r.date ?? '');
    const at = Date.parse(date);
    if (!Number.isFinite(at)) continue;
    const name = String(r.event ?? 'Macro');
    out.push({ id: `${name}-${at}`, name, at, impact: 'HIGH', currencies: ['USD'] });
  }
  return out;
};
