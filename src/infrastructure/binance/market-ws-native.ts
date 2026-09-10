import type { WsFactory, WsHandlers, WsHandle } from './market-stream.js';

interface NativeWebSocketLike {
  addEventListener(type: 'open', cb: () => void): void;
  addEventListener(type: 'message', cb: (ev: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close', cb: (ev: { readonly code: number }) => void): void;
  addEventListener(type: 'error', cb: () => void): void;
  close(): void;
}

export const nativeWsFactory: WsFactory = (url: string, handlers: WsHandlers): WsHandle => {
  const Ctor = (globalThis as typeof globalThis & {
    WebSocket: new (url: string) => NativeWebSocketLike;
  }).WebSocket;
  const socket = new Ctor(url);
  socket.addEventListener('open', (): void => handlers.onOpen());
  socket.addEventListener('message', (ev): void => {
    if (typeof ev.data === 'string') handlers.onMessage(ev.data);
  });
  socket.addEventListener('close', (ev): void => handlers.onClose(`code ${ev.code}`));
  socket.addEventListener('error', (): void => undefined);
  return { close: (): void => socket.close() };
};
