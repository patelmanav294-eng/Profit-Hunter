/**
 * Binance spot klines. Keyless, generous rate limits, clean OHLCV.
 * Crypto only — for FX use the Yahoo adapter.
 */

import type { Bar } from "../../engine/types";
import { dropUnclosedBar, type FetchRequest, type MarketDataSource, type Timeframe } from "./index";

const INTERVALS: Record<Timeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
  W1: "1w",
};

/** Binance caps a single klines call at 1000 candles. */
const MAX_PER_REQUEST = 1000;

export const binanceSource: MarketDataSource = {
  id: "binance",
  label: "Binance (crypto)",
  symbolHint: "Exchange symbols without a separator, e.g. BTCUSDT, ETHUSDT, SOLUSDT",

  async fetchBars(request: FetchRequest, fetchImpl: typeof fetch = fetch): Promise<Bar[]> {
    const symbol = request.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const interval = INTERVALS[request.timeframe];
    const bars: Bar[] = [];
    let endTime: number | undefined;

    // Page backwards from newest until we have enough bars or the history ends.
    while (bars.length < request.limit) {
      const remaining = Math.min(request.limit - bars.length, MAX_PER_REQUEST);
      const params = new URLSearchParams({ symbol, interval, limit: String(remaining) });
      if (endTime !== undefined) params.set("endTime", String(endTime));

      const response = await fetchImpl(`https://api.binance.com/api/v3/klines?${params}`);
      if (!response.ok) {
        throw new Error(`Binance returned ${response.status} for ${symbol} — check the symbol exists on spot`);
      }

      const rows = (await response.json()) as unknown[][];
      if (rows.length === 0) break;

      const page = rows.map(toBar);
      bars.unshift(...page);
      // Step back one millisecond past the oldest bar we just received.
      endTime = page[0].time - 1;
      if (rows.length < remaining) break;
    }

    return dropUnclosedBar(bars, request.timeframe);
  },
};

function toBar(row: unknown[]): Bar {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}
