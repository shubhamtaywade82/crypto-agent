import type React from 'react';
import { getKernel } from '../kernel.js';
import { ensureSymbolTracked } from '../engines/market-hydrate.js';
import { systemEntry, type TranscriptEntry } from './transcript.js';
import type { WorkspaceTab } from './types.js';

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
  readonly setActiveTab?: (tab: WorkspaceTab) => void;
}

const TAB_MAP: Record<string, WorkspaceTab> = {
  '1': 'overview', 'overview': 'overview',
  '2': 'agent', 'agent': 'agent', 'chat': 'agent',
  '3': 'opps', 'opps': 'opps', 'opportunities': 'opps',
  '4': 'positions', 'positions': 'positions', 'pos': 'positions',
  '5': 'orders', 'orders': 'orders',
  '6': 'risk', 'risk': 'risk',
  '7': 'strategies', 'strategies': 'strategies', 'strat': 'strategies',
  '8': 'learning', 'learning': 'learning', 'learn': 'learning',
  '9': 'events', 'events': 'events',
  '0': 'system', 'system': 'system', 'sys': 'system',
};

const runTabCmd = (ctx: CommandCtx, t: string): boolean => {
  if (!ctx.setActiveTab) return false;
  let target = '';
  if (t.startsWith('/tab ')) target = t.slice(5).trim().toLowerCase();
  else if (t.startsWith('/') && TAB_MAP[t.slice(1).toLowerCase()]) target = t.slice(1).toLowerCase();
  if (target && TAB_MAP[target]) {
    ctx.setActiveTab(TAB_MAP[target]!);
    ctx.pushActivity(`Tab → ${TAB_MAP[target]}`);
    return true;
  }
  return false;
};

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
  if (t.startsWith('/pause')) {
    ctx.setAuto((p) => ({ ...p, enabled: false }));
    ctx.pushActivity('Auto-trading PAUSED'); return true;
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
  if (t === 'exit' || t === 'quit' || t === '/quit' || t === '/exit' || t === '/q') { ctx.exit(); return true; }
  if (t === '/clear') { ctx.chat.clearMessages(); ctx.clearTranscript(); return true; }
  if (t === '/help' || t === '/?') {
    ctx.pushTranscript(systemEntry('Commands', [
      'Tabs: /1../0 or /tab <name> (overview, agent, opps, pos, orders, risk, strat, learn, events, sys)',
      'Trading: /focus SYM  /scan  /pipeline SYM  /halt  /resume  /pause  /auto on|off  /clear  /quit',
      'Keys: Tab cycle tabs │ PgUp/Dn scroll │ ↑/↓ history │ Enter send │ Ctrl+P pause │ Ctrl+C quit',
      'Chat: Ask any natural question, e.g. "why was BTC rejected?" "show positions"',
    ]));
    return true;
  }
  if (runTabCmd(ctx, t)) return true;
  const focusArg = t.startsWith('/focus ') ? t.slice(7) : t.startsWith('/sym ') ? t.slice(5) : '';
  if (focusArg) { applyFocus(ctx, focusArg.trim().toUpperCase()); return true; }
  return runTradingCmd(ctx, t);
};
