import type { WatchTriggerEvent } from '../types.js';

interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

const getConfig = (): TelegramConfig | null => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
};

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Formats the agent's final analysis into a clean Telegram message
const formatAnalysisCard = (
  event: WatchTriggerEvent,
  analysis: string
): string => {
  const { condition, currentPrice, triggeredAt } = event;
  const direction = condition.type === 'price_above' ? '📈 BREAKOUT' : '📉 BREAKDOWN';
  const time = new Date(triggeredAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  });

  // Trim analysis to Telegram's 4096 char limit (minus card overhead)
  const maxLen = 3200;
  const trimmed = analysis.length > maxLen
    ? `${analysis.slice(0, maxLen)}…`
    : analysis;

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
    `<b>🤖 Agent Analysis:</b>`,
    '',
    `<pre>${escapeHtml(trimmed)}</pre>`,
  ].join('\n');
};

export const sendTelegramAlert = async (
  event: WatchTriggerEvent,
  analysis: string
): Promise<boolean> => {
  const config = getConfig();
  if (!config) return false;

  const text = formatAnalysisCard(event, analysis);
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
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** Send arbitrary HTML to Telegram (council cards, status, etc.). */
export const sendTelegramHtml = async (text: string, silent = false): Promise<boolean> => {
  const config = getConfig();
  if (!config) return false;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId, text, parse_mode: 'HTML',
        disable_web_page_preview: true, disable_notification: silent,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// Lightweight status notification (watcher connected, errors, etc.)
export const sendTelegramStatus = async (
  message: string
): Promise<boolean> => {
  const config = getConfig();
  if (!config) return false;

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: `🤖 <b>Crypto Agent</b>\n\n${escapeHtml(message)}`,
        parse_mode: 'HTML',
        disable_notification: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
