/** Lightweight structured logger with decision correlation. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

const emit = (level: Level, component: string, msg: string, meta?: unknown): void => {
  if (LEVELS[level] < minLevel) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(meta !== undefined ? { meta } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
};

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(component: string): Logger;
}

export const createLogger = (component: string): Logger => ({
  debug: (msg, meta) => emit('debug', component, msg, meta),
  info: (msg, meta) => emit('info', component, msg, meta),
  warn: (msg, meta) => emit('warn', component, msg, meta),
  error: (msg, meta) => emit('error', component, msg, meta),
  child: (sub) => createLogger(`${component}:${sub}`),
});
