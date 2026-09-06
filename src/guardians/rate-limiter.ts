interface WeightRecord {
  readonly weight: number;
  readonly timestamp: number;
}

export class BinanceRateLimiter {
  private history: WeightRecord[] = [];
  private readonly windowMs = 60_000;
  // Binance hard limit is 1200 weight/min per IP
  public readonly maxWeight = 1200;
  // Safe buffer threshold before sleeping to avoid 429/418 IP bans
  public readonly safeThreshold = 1000;

  private readonly weightMap: Readonly<Record<string, number>> = {
    ping: 1,
    server_time: 1,
    exchange_info: 10,
    get_price: 2,
    get_all_prices: 2,
    get_avg_price: 2,
    get_book_ticker: 2,
    get_order_book: 10,
    get_klines: 2,
    get_recent_trades: 2,
    get_historical_trades: 10,
    get_live_price: 0,
    ticker24hr: 2,
    depth: 10,
    klines: 2,
    trades: 2,
    avgPrice: 2,
  };

  private cleanWindow(): void {
    const cutoff = Date.now() - this.windowMs;
    this.history = this.history.filter((item) => item.timestamp > cutoff);
  }

  public getCurrentWeight(): number {
    this.cleanWindow();
    return this.history.reduce((sum, item) => sum + item.weight, 0);
  }

  public async requestPermission(toolName: string): Promise<void> {
    const weight = this.weightMap[toolName] ?? 2;
    this.cleanWindow();

    const projected = this.getCurrentWeight() + weight;
    if (projected >= this.safeThreshold) {
      const oldest = this.history[0];
      if (oldest) {
        // Sleep until the oldest request falls outside the 60s rolling window
        const timeToReset = this.windowMs - (Date.now() - oldest.timestamp);
        const sleepMs = Math.max(timeToReset + 1000, 1000);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        this.cleanWindow();
      }
    }

    this.history.push({ weight, timestamp: Date.now() });
  }

  public reset(): void {
    this.history = [];
  }
}

export const binanceRateLimiter = new BinanceRateLimiter();
