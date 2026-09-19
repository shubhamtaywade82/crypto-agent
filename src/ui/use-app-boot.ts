import { useEffect, useRef, useState } from 'react';
import { getKernel } from '../kernel.js';
import { bootEventCouncil } from '../engines/event-council.js';
import { hydrateWatchMicro, refreshSymbolQuote } from '../engines/market-hydrate.js';
import { kernelWatchSymbols } from '../kernel-streams.js';

const isStreamLive = (): boolean => getKernel().streams.market?.status().state === 'LIVE';

const QUOTE_REFRESH_EVERY_TICKS = 5;

export const useStreamBoot = (): boolean => {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const kernel = getKernel();
    kernel.reconciler.start();
    void kernel.startStreams()
      .then(() => { bootEventCouncil(kernel); return hydrateWatchMicro(); })
      .then(() => setLive(isStreamLive()))
      .catch(() => setLive(false));
    let ticks = 0;
    const poll = setInterval(() => {
      setLive(isStreamLive());
      ticks += 1;
      if (ticks % QUOTE_REFRESH_EVERY_TICKS === 0) {
        for (const sym of kernelWatchSymbols()) void refreshSymbolQuote(sym);
      }
    }, 1000);
    return (): void => {
      clearInterval(poll);
      kernel.reconciler.stop();
      kernel.stopStreams();
    };
  }, []);
  return live;
};

export const useAutoScan = (
  enabled: boolean,
  intervalSec: number,
  run: () => Promise<void>,
  busy: boolean
): void => {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return undefined;
    if (!busyRef.current) void runRef.current();
    const t = setInterval(() => {
      if (!busyRef.current) void runRef.current();
    }, intervalSec * 1000);
    return (): void => clearInterval(t);
  }, [enabled, intervalSec]);
};
