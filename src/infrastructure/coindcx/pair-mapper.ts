/**
 * CoinDCX pair conventions:
 *   USDT-margined futures: B-SOL_USDT  (ecode `B`, quote USDT)
 *   INR-margined futures:  B-SOL_INR   (ecode `B`, quote INR)
 *   Spot INR market:       SOLINR / USDTINR
 */
export const futuresPair = (base: string, quote: 'USDT' | 'INR'): string =>
  `B-${base.toUpperCase()}_${quote}`;

export const parseFuturesPair = (
  pair: string
): { base: string; quote: string } | undefined => {
  const m = /^([A-Z])-([A-Z0-9]+)_([A-Z]+)$/.exec(pair.toUpperCase());
  if (!m) return undefined;
  return { base: m[2]!, quote: m[3]! };
};

export const baseAssetOfBinanceSymbol = (symbol: string): string => {
  const s = symbol.toUpperCase();
  if (s.endsWith('USDT')) return s.slice(0, -4);
  if (s.endsWith('BUSD')) return s.slice(0, -4);
  if (s.endsWith('USDC')) return s.slice(0, -4);
  if (s.endsWith('INR')) return s.slice(0, -3);
  return s;
};
