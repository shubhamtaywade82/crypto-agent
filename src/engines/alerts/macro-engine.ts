import fs from 'node:fs';
import type { MarketStateStore } from '../market-state-store.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';
import { sharedMacroPolicy } from './macro-policy.js';
import {
  defaultCalendar, mapFinnhub, newsFromRss, parseCalendarJson, parseNewsJson,
  type CalendarItem, type NewsItem,
} from './macro-calendar.js';

const T45 = 45 * 60_000;
const T5 = 5 * 60_000;
const RESOLVE = 15 * 60_000;

const loadFileCalendar = (): CalendarItem[] => {
  const path = process.env.MACRO_CALENDAR_PATH;
  if (!path || !fs.existsSync(path)) return defaultCalendar();
  try {
    return parseCalendarJson(JSON.parse(fs.readFileSync(path, 'utf-8')));
  } catch {
    return defaultCalendar();
  }
};

const fetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return undefined;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('xml') || ct.includes('rss') || url.endsWith('.xml')) return res.text();
  return res.json();
};

export class MacroEngine {
  private calendar: CalendarItem[] = defaultCalendar();
  private readonly stages = new Map<string, string>();
  private readonly newsSeen = new Set<string>();
  private readonly prices = new Map<string, number>();

  constructor(
    private readonly dispatcher: AlertDispatcher,
    private readonly marketStore: MarketStateStore,
    private readonly symbols: () => readonly string[]
  ) {}

  async refreshFeeds(): Promise<void> {
    this.calendar = loadFileCalendar();
    const url = process.env.MACRO_CALENDAR_URL;
    const key = process.env.FINNHUB_API_KEY;
    try {
      if (url) {
        const data = await fetchJson(url);
        const parsed = parseCalendarJson(data);
        if (parsed.length > 0) this.calendar = parsed;
      } else if (key) {
        const from = new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
        const data = await fetchJson(
          `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`
        );
        const mapped = mapFinnhub(data);
        if (mapped.length > 0) this.calendar = mapped;
      }
    } catch { /* fail-closed: keep last calendar */ }
  }

  async tick(now = Date.now()): Promise<void> {
    await this.scanCalendar(now);
    await this.scanNews();
  }

  private async scanCalendar(now: number): Promise<void> {
    for (const ev of this.calendar.filter((e) => e.impact === 'HIGH')) {
      const eta = ev.at - now;
      if (eta > T45 || eta < -RESOLVE) {
        if (eta < -RESOLVE) this.clear(ev.id);
        continue;
      }
      const stage = eta <= T5 && eta >= 0 ? 'T5' : eta > 0 ? 'T45' : 'LIVE';
      await this.transition(ev, stage, now);
    }
  }

  private async transition(ev: CalendarItem, stage: string, now: number): Promise<void> {
    const prev = this.stages.get(ev.id);
    if (prev === stage) return;
    this.stages.set(ev.id, stage);
    if (stage === 'T45') {
      sharedMacroPolicy.set('HIGH', ev.name);
      await this.emit({ ev, title: 'MACRO EVENT APPROACHING', severity: 'WATCH',
        body: 'In: 45 minutes\nExpected volatility: HIGH', state: 'T45' });
      return;
    }
    if (stage === 'T5') {
      sharedMacroPolicy.set('VERY_HIGH', ev.name);
      await this.emit({ ev, title: 'MACRO EVENT', severity: 'IMPORTANT',
        body: 'Starts in 5 minutes\nEvent risk: VERY HIGH\nStatus: WAITING FOR POST-EVENT PRICE DISCOVERY', state: 'T5' });
      return;
    }
    if (stage === 'LIVE' && prev && now >= ev.at) {
      sharedMacroPolicy.set('NONE', ev.name);
      await this.emitResolved(ev);
    }
  }

  private async emitResolved(ev: CalendarItem): Promise<void> {
    const lines = this.symbols().map((sym) => {
      const snap = this.marketStore.snapshot(sym);
      const last = snap?.last;
      const prev = this.prices.get(sym);
      if (last !== undefined) this.prices.set(sym, last);
      if (prev !== undefined && last !== undefined) return `${sym}: ${prev.toFixed(2)} → ${last.toFixed(2)}`;
      return `${sym}: ${last?.toFixed(2) ?? '—'}`;
    });
    await this.emit({
      ev, title: 'MACRO EVENT RESOLVED', severity: 'IMPORTANT',
      body: `${ev.name} released\n${lines.join('\n')}`, state: 'RESOLVED',
    });
  }

  private async emit(p: {
    readonly ev: CalendarItem;
    readonly title: string;
    readonly severity: 'WATCH' | 'IMPORTANT';
    readonly body: string;
    readonly state: string;
  }): Promise<void> {
    await this.dispatcher.publish(makeAlert({
      at: Date.now(),
      class: 'MACRO',
      severity: p.severity,
      title: p.title,
      body: `${p.ev.name}\n${p.body}\nAffected: ${this.symbols().join(', ')}`,
      fingerprint: `MACRO:${p.ev.id}`,
      stateFrom: this.stages.get(p.ev.id),
      stateTo: p.state,
      payload: { eventId: p.ev.id, name: p.ev.name },
    }));
  }

  private clear(id: string): void {
    this.stages.delete(id);
  }

  private async scanNews(): Promise<void> {
    const url = process.env.MACRO_NEWS_URL;
    if (!url) return;
    try {
      const data = await fetchJson(url);
      const items: NewsItem[] = typeof data === 'string' ? newsFromRss(data) : parseNewsJson(data);
      for (const n of items.filter((i) => (i.impact ?? 'HIGH') === 'HIGH')) {
        if (this.newsSeen.has(n.id)) continue;
        this.newsSeen.add(n.id);
        await this.dispatcher.publish(makeAlert({
          at: n.at,
          class: 'MACRO',
          severity: 'IMPORTANT',
          title: 'MACRO NEWS',
          body: n.title,
          fingerprint: `MACRO:news:${n.id}`,
          stateTo: 'NEWS',
          payload: { title: n.title },
        }));
      }
    } catch { /* ignore bad news feed */ }
  }
}
