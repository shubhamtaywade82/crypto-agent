import type React from 'react';
import { getKernel } from '../kernel.js';
import { ensureSymbolTracked } from '../engines/market-hydrate.js';
import { systemEntry, type TranscriptEntry } from './transcript.js';

export interface CommandCtx {
  readonly input: string;
  readonly focusSymbol: string;
  readonly setFocusSymbol: (s: string) => void;
  readonly setAuto: React.Dispatch<React.SetStateAction<{ enabled: boolean; interval: number }>>;
  readonly chat: {
    runTurn: (p: string) => Promise<string>;
    runPipelineTrace: (s: string) => Promise<void>;
    runKernelScan: (s?: readonly string[]) => Promise<void>;
    clearMessages: () => void;
    addSystemNote: (m: string) => void;
  };
  readonly pushActivity: (t: string) => void;
  readonly pushTranscript: (e: TranscriptEntry) => void;
  readonly clearTranscript: () => void;
  readonly exit: () => void;
}

const applyFocus = (ctx: CommandCtx, sym: string): void => {
  ctx.setFocusSymbol(sym);
  void ensureSymbolTracked(sym).then((ok) => {
    ctx.pushActivity(ok ? `Focus → ${sym} (depth loaded)` : `Focus → ${sym} (depth pending)`);
  });
};

const runTradingCmd = (ctx: CommandCtx, t: string): boolean => {
  if (t.startsWith('/halt') || t.startsWith('/kill')) {
    getKernel().killSwitch.halt(t.slice(5).trim() || 'operator halt', 'operator');
    ctx.pushActivity('Kill switch ENGAGED'); return true;
  }
  if (t.startsWith('/resume')) {
    getKernel().killSwitch.resume(t.slice(8).trim() || 'operator resume', 'operator');
    ctx.pushActivity('Kill switch disengaged'); return true;
  }
  if (t.startsWith('/auto')) {
    const arg = t.split(/\s+/)[1]?.toLowerCase();
    if (arg === 'off') ctx.setAuto((p) => ({ ...p, enabled: false }));
    else if (arg === 'on') ctx.setAuto((p) => ({ ...p, enabled: true }));
    else ctx.setAuto((p) => ({ ...p, enabled: !p.enabled }));
    return true;
  }
  const pSym = t.startsWith('/pipeline') ? t.split(/\s+/)[1]?.toUpperCase() || ctx.focusSymbol
    : t.startsWith('/scan ') ? t.slice(6).trim().toUpperCase() : null;
  if (pSym) { void ctx.chat.runPipelineTrace(pSym); return true; }
  if (t === '/scan') { void ctx.chat.runKernelScan(); return true; }
  return false;
};

export const runCommand = (ctx: CommandCtx): boolean => {
  const t = ctx.input.trim();
  if (!t) return true;
  if (t === 'exit' || t === 'quit') { ctx.exit(); return true; }
  if (t === '/clear') { ctx.chat.clearMessages(); ctx.clearTranscript(); return true; }
  if (t === '/help') {
    ctx.pushTranscript(systemEntry('Commands', [
      '/focus SYM  /scan  /pipeline SYM  /halt  /resume  /auto on|off  /clear',
      'Ask naturally: "why was BTC rejected?" "show positions" "trace last decision"',
    ]));
    return true;
  }
  const focusArg = t.startsWith('/focus ') ? t.slice(7) : t.startsWith('/sym ') ? t.slice(5) : '';
  if (focusArg) { applyFocus(ctx, focusArg.trim().toUpperCase()); return true; }
  return runTradingCmd(ctx, t);
};
