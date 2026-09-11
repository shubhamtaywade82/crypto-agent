import type { Timeframe } from '../domain/market/types.js';
import type { MiEventKind } from './mi-event-scan.js';
import type { WatchTriggerEvent } from '../types.js';

export type CouncilTrigger =
  | { readonly type: 'PRICE_WATCH'; readonly event: WatchTriggerEvent }
  | { readonly type: 'CANDLE_CLOSE'; readonly symbol: string; readonly timeframe: Timeframe }
  | { readonly type: 'REGIME_CHANGE'; readonly symbol: string; readonly from: string; readonly to: string }
  | { readonly type: 'SETUP_DETECTED'; readonly symbol: string; readonly count: number }
  | {
    readonly type: 'MARKET_EVENT';
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly eventType: MiEventKind;
    readonly eventId: string;
    readonly direction: string;
    readonly label: string;
  };
