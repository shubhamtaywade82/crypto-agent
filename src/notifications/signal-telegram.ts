import type { Timeframe } from '../domain/market/types.js';
import type { CouncilTrigger } from '../engines/council-types.js';
import type { MiFreshEvent } from '../engines/mi-event-scan.js';
import { escapeHtml, sendTelegramHtml } from './telegram.js';

const alertsEnabled = (): boolean => process.env.TELEGRAM_EVENT_ALERTS !== 'false';

const istTime = (): string =>
  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

export const formatMarketEventAlert = (
  symbol: string,
  timeframe: Timeframe,
  ev: MiFreshEvent
): string =>
  [
    `<b>📡 Market event — ${escapeHtml(symbol)}</b>`,
    `TF: ${timeframe} · ${escapeHtml(ev.eventType)} · ${escapeHtml(ev.direction)}`,
    escapeHtml(ev.label),
    `🕒 ${istTime()} IST`,
    '',
    '<i>Deterministic detection (WS candle close). LLM review may follow if confidence gate passes.</i>',
  ].join('\n');

export const formatCouncilTriggerAlert = (trigger: CouncilTrigger): string => {
  if (trigger.type === 'REGIME_CHANGE') {
    return [
      `<b>🔄 Regime — ${escapeHtml(trigger.symbol)}</b>`,
      `${escapeHtml(trigger.from)} → ${escapeHtml(trigger.to)}`,
      `🕒 ${istTime()} IST`,
    ].join('\n');
  }
  if (trigger.type === 'SETUP_DETECTED') {
    return [
      `<b>🎯 Setup candidates — ${escapeHtml(trigger.symbol)}</b>`,
      `Active setups: ${trigger.count}`,
      `🕒 ${istTime()} IST`,
    ].join('\n');
  }
  return `<b>⚡ ${escapeHtml(trigger.type)}</b>`;
};

export const sendMarketEventAlert = async (
  symbol: string,
  timeframe: Timeframe,
  ev: MiFreshEvent
): Promise<boolean> => {
  if (!alertsEnabled()) return false;
  return sendTelegramHtml(formatMarketEventAlert(symbol, timeframe, ev), {
    channel: 'alert',
    silent: false,
  });
};

export const sendTriggerAlert = async (trigger: CouncilTrigger): Promise<boolean> => {
  if (!alertsEnabled()) return false;
  if (trigger.type !== 'REGIME_CHANGE' && trigger.type !== 'SETUP_DETECTED') return false;
  return sendTelegramHtml(formatCouncilTriggerAlert(trigger), { channel: 'alert', silent: false });
};
