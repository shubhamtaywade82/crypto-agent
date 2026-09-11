import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PromptHistory } from '../src/ui/history.js';
import { runCommand, type CommandCtx } from '../src/ui/app-commands.js';
import type { WorkspaceTab } from '../src/ui/types.js';

describe('PromptHistory', () => {
  const tmpFile = path.join(os.tmpdir(), `test_crypto_agent_history_${Date.now()}.txt`);

  beforeEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('initializes cleanly when history file does not exist', () => {
    const hist = new PromptHistory(tmpFile);
    expect(hist.navigateUp('')).toBeUndefined();
    expect(hist.navigateDown()).toBeUndefined();
  });

  it('saves prompt and allows Up/Down navigation while preserving draft', () => {
    const hist = new PromptHistory(tmpFile);
    hist.save('first query');
    hist.save('second query');

    // Currently typing draft
    expect(hist.navigateUp('my draft')).toBe('second query');
    expect(hist.navigateUp('second query')).toBe('first query');
    // Boundary at top
    expect(hist.navigateUp('first query')).toBe('first query');

    // Down navigation restores previous entries and finally draft
    expect(hist.navigateDown()).toBe('second query');
    expect(hist.navigateDown()).toBe('my draft');
  });

  it('persists history to disk and loads across instances', () => {
    const h1 = new PromptHistory(tmpFile);
    h1.save('BTCUSDT analysis');
    h1.save('SOLUSDT analysis');

    const h2 = new PromptHistory(tmpFile);
    expect(h2.navigateUp('')).toBe('SOLUSDT analysis');
    expect(h2.navigateUp('')).toBe('BTCUSDT analysis');
  });

  it('deduplicates consecutive identical submissions', () => {
    const hist = new PromptHistory(tmpFile);
    hist.save('SOLUSDT');
    hist.save('SOLUSDT');

    expect(hist.navigateUp('')).toBe('SOLUSDT');
    expect(hist.navigateUp('')).toBe('SOLUSDT');
  });

  it('exposes saved items via getItems', () => {
    const hist = new PromptHistory(tmpFile);
    hist.save('item 1');
    hist.save('item 2');
    expect(hist.getItems()).toEqual(['item 1', 'item 2']);
  });
});

describe('runCommand', () => {
  const makeCtx = (input: string, onTab?: (t: WorkspaceTab) => void, onAuto?: (b: boolean) => void): {
    ctx: CommandCtx;
    activities: string[];
  } => {
    const activities: string[] = [];
    const ctx: CommandCtx = {
      input,
      focusSymbol: 'BTCUSDT',
      setFocusSymbol: () => {},
      setAuto: (arg) => {
        if (typeof arg === 'function') {
          const res = arg({ enabled: true, interval: 300 });
          onAuto?.(res.enabled);
        }
      },
      chat: {
        runTurn: async () => '',
        runPipelineTrace: async () => {},
        runKernelScan: async () => {},
        clearMessages: () => {},
        addSystemNote: () => {},
      },
      pushActivity: (t) => activities.push(t),
      pushTranscript: () => {},
      clearTranscript: () => {},
      exit: () => {},
      setActiveTab: onTab,
    };
    return { ctx, activities };
  };

  it('switches tabs via /tab and /<number> commands', () => {
    let tab: WorkspaceTab = 'overview';
    const { ctx: c1 } = makeCtx('/tab agent', (t) => { tab = t; });
    expect(runCommand(c1)).toBe(true);
    expect(tab).toBe('agent');

    const { ctx: c2 } = makeCtx('/3', (t) => { tab = t; });
    expect(runCommand(c2)).toBe(true);
    expect(tab).toBe('opps');

    const { ctx: c3 } = makeCtx('/risk', (t) => { tab = t; });
    expect(runCommand(c3)).toBe(true);
    expect(tab).toBe('risk');

    const { ctx: c4 } = makeCtx('/0', (t) => { tab = t; });
    expect(runCommand(c4)).toBe(true);
    expect(tab).toBe('system');
  });

  it('handles /pause command', () => {
    let autoEnabled = true;
    const { ctx, activities } = makeCtx('/pause', undefined, (b) => { autoEnabled = b; });
    expect(runCommand(ctx)).toBe(true);
    expect(autoEnabled).toBe(false);
    expect(activities).toContain('Auto-trading PAUSED');
  });
});
