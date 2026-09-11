import { useEffect, useRef, useState } from 'react';
import { getKernel } from '../kernel.js';
import { bootEventCouncil } from '../engines/event-council.js';
import { hydrateWatchMicro } from '../engines/market-hydrate.js';
import { kernelWatchSymbols } from '../kernel-streams.js';

const hasMicroData = (): boolean =>
  kernelWatchSymbols().some((sym) => (getKernel().marketStore.snapshot(sym)?.bids.length ?? 0) > 0);

export const useStreamBoot = (): boolean => {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const kernel = getKernel();
    void kernel.startStreams()
      .then(() => { bootEventCouncil(kernel); return hydrateWatchMicro(); })
      .then(() => setLive(hasMicroData()))
      .catch(() => setLive(false));
    const poll = setInterval(() => { if (hasMicroData()) setLive(true); }, 1000);
    return (): void => { clearInterval(poll); kernel.stopStreams(); };
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
