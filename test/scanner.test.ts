import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AutonomousScanner, buildScanPrompt, TARGET_ALTCOINS, MACRO_COIN } from '../src/engine/scanner.js';
import type { WatchOrchestrator } from '../src/engine/orchestrator.js';

describe('AutonomousScanner', () => {
  let mockOrchestrator: WatchOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOrchestrator = {
      journal: { getRecentLessons: vi.fn().mockReturnValue([]) },
    } as unknown as WatchOrchestrator;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds comprehensive scan prompt with macro coin and target altcoins', () => {
    const prompt = buildScanPrompt(['SOLUSDT', 'ETHUSDT', 'XRPUSDT']);
    expect(prompt).toContain(MACRO_COIN);
    expect(prompt).toContain('SOLUSDT');
    expect(prompt).toContain('ETHUSDT');
    expect(prompt).toContain('XRPUSDT');
    expect(prompt).toContain('get_learned_rules');
    expect(prompt).toContain('log_trade_setup');
    expect(prompt).toContain('register_price_watch');
  });

  it('initializes in idle state and tracks execution stats', () => {
    const scanner = new AutonomousScanner({ orchestrator: mockOrchestrator });
    expect(scanner.isRunning).toBe(false);
    expect(scanner.isScanning).toBe(false);
    expect(scanner.totalScans).toBe(0);
    expect(scanner.lastScan).toBeUndefined();
  });

  it('starts periodic timer and stops cleanly', () => {
    const scanner = new AutonomousScanner({
      orchestrator: mockOrchestrator,
      intervalMs: 60_000,
    });

    // Mock scanOnce to avoid invoking actual agent
    const scanOnceSpy = vi.spyOn(scanner, 'scanOnce').mockResolvedValue('Scan complete');

    scanner.start(60_000);
    expect(scanner.isRunning).toBe(true);
    expect(scanOnceSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(scanOnceSpy).toHaveBeenCalledTimes(2);

    scanner.stop();
    expect(scanner.isRunning).toBe(false);

    vi.advanceTimersByTime(120_000);
    expect(scanOnceSpy).toHaveBeenCalledTimes(2);
  });
});
