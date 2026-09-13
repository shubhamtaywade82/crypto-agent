import type { AlertClass, AlertEvent, AlertSeverity } from '../domain/alerts/types.js';
import { escapeHtml, sendTelegramHtml, type TelegramBotKind } from './telegram.js';

const TAG: Readonly<Record<AlertClass, string>> = {
  SYSTEM: 'SYSTEM',
  MACRO: 'MACRO',
  MARKET: 'MARKET',
  LEVEL: 'LEVEL',
  SETUP: 'SETUP',
  SIGNAL: 'SIGNAL',
  TRADE: 'TRADE',
  RESEARCH: 'RESEARCH',
};

const silentFor = (severity: AlertSeverity, cls: AlertClass): boolean => {
  if (cls === 'SYSTEM' && severity === 'CRITICAL') return false;
  if (severity === 'SIGNAL' || severity === 'CRITICAL') return false;
  if (cls === 'TRADE') return false;
  return severity === 'INFO' || severity === 'WATCH';
};

const channelFor = (cls: AlertClass): TelegramBotKind =>
  cls === 'SIGNAL' || cls === 'TRADE' ? 'trading' : 'alert';

export const formatAlertHtml = (event: AlertEvent): string => {
  const tag = TAG[event.class];
  const sym = event.symbol ? ` ${escapeHtml(event.symbol)}` : '';
  const lines = [
    `<b>[ ${tag} ]</b>${sym}`,
    `<b>${escapeHtml(event.title)}</b>`,
    ...event.body.split('\n').map((l) => escapeHtml(l)),
  ];
  const text = lines.join('\n');
  return text.length > 3500 ? `${text.slice(0, 3497)}…` : text;
};

export const sendAlertTelegram = async (event: AlertEvent): Promise<boolean> => {
  if (process.env.TELEGRAM_EVENT_ALERTS === 'false') return false;
  return sendTelegramHtml(formatAlertHtml(event), {
    channel: channelFor(event.class),
    silent: silentFor(event.severity, event.class),
  });
};
