import type { WatchTriggerEvent } from '../types.js';

export type TelegramBotKind = 'alert' | 'trading';

interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export interface TelegramSendOptions {
  readonly channel?: TelegramBotKind;
  readonly silent?: boolean;
}

const chatId = (): string | undefined => process.env.TELEGRAM_CHAT_ID?.trim();

const resolveBotToken = (kind: TelegramBotKind): string | undefined => {
  if (kind === 'trading') {
    return (
      process.env.TELEGRAM_TRADING_BOT_TOKEN?.trim() ??
      process.env.TELEGRAM_BOT_TOKEN?.trim()
    );
  }
  return (
    process.env.TELEGRAM_ALERTBOT_BOT_TOKEN?.trim() ??
    process.env.TELEGRAM_BOT_TOKEN?.trim()
  );
};

const getSendConfig = (kind: TelegramBotKind): TelegramConfig | null => {
  const id = chatId();
  const botToken = resolveBotToken(kind);
  if (!botToken || !id) return null;
  return { botToken, chatId: id };
};

/** @deprecated use getSendConfig('alert'|'trading') — kept for tests */
const getConfig = (): TelegramConfig | null => getSendConfig('alert');

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const telegramConfigured = (): boolean =>
  Boolean(chatId() && (resolveBotToken('alert') || resolveBotToken('trading')));

const postMessage = async (text: string, kind: TelegramBotKind, silent: boolean): Promise<boolean> => {
  const config = getSendConfig(kind);
  if (!config) return false;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const formatAnalysisCard = (event: WatchTriggerEvent, analysis: string): string => {
  const { condition, currentPrice, triggeredAt } = event;
  const direction = condition.type === 'price_above' ? '📈 BREAKOUT' : '📉 BREAKDOWN';
  const time = new Date(triggeredAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  });
  const maxLen = 3200;
  const trimmed = analysis.length > maxLen ? `${analysis.slice(0, maxLen)}…` : analysis;
  return [
    `${direction} <b>${escapeHtml(condition.symbol)}</b>`,
    '',
    `🎯 <b>Target Hit:</b> $${condition.targetPrice}`,
    `💵 <b>Current Price:</b> $${currentPrice}`,
    `📊 <b>Strategy:</b> ${escapeHtml(condition.strategy)}`,
    `🕒 <b>Time:</b> ${time} IST`,
    '',
    '─'.repeat(30),
    '',
    '<b>🤖 Agent Analysis:</b>',
    '',
    `<pre>${escapeHtml(trimmed)}</pre>`,
  ].join('\n');
};

export const sendTelegramAlert = async (
  event: WatchTriggerEvent,
  analysis: string
): Promise<boolean> => {
  if (!getSendConfig('trading') && !getSendConfig('alert')) return false;
  const text = formatAnalysisCard(event, analysis);
  const channel: TelegramBotKind = getSendConfig('trading') ? 'trading' : 'alert';
  return postMessage(text, channel, false);
};

export const sendTelegramHtml = async (
  text: string,
  silentOrOpts: boolean | TelegramSendOptions = false
): Promise<boolean> => {
  const opts: TelegramSendOptions =
    typeof silentOrOpts === 'boolean' ? { silent: silentOrOpts } : silentOrOpts;
  const channel = opts.channel ?? 'alert';
  return postMessage(text, channel, opts.silent ?? false);
};

export const sendTelegramStatus = async (message: string): Promise<boolean> =>
  sendTelegramHtml(`🤖 <b>Crypto Agent</b>\n\n${escapeHtml(message)}`, {
    channel: 'alert',
    silent: true,
  });

export { getConfig };
