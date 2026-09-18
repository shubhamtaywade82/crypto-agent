import { useEffect, useRef, useState } from 'react';
import { getKernel } from '../kernel.js';
import { bootEventCouncil } from '../engines/event-council.js';
import { hydrateWatchMicro } from '../engines/market-hydrate.js';

const isStreamLive = (): boolean => getKernel().streams.market?.status().state === 'LIVE';

export const useStreamBoot = (): boolean => {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const kernel = getKernel();
    kernel.reconciler.start();
    void kernel.startStreams()
      .then(() => { bootEventCouncil(kernel); return hydrateWatchMicro(); })
      .then(() => setLive(isStreamLive()))
      .catch(() => setLive(false));
    const poll = setInterval(() => { setLive(isStreamLive()); }, 1000);
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
