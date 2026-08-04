/**
 * Live data adapters.
 *
 * Both providers below are keyless, which keeps the project runnable with no
 * signup. Neither sends CORS headers, so calls go through the bundled dev
 * proxy (`server/proxy.ts`) rather than straight from the browser.
 */

import type { Bar } from "../../engine/types";

export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
  W1: 604_800_000,
};

export interface FetchRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Maximum bars to return, newest-anchored. */
  limit: number;
}

export interface MarketDataSource {
  readonly id: string;
  readonly label: string;
  /** Human-readable hint about what symbols this source accepts. */
  readonly symbolHint: string;
  fetchBars(request: FetchRequest, fetchImpl?: typeof fetch): Promise<Bar[]>;
}

/**
 * Drops the final bar when it is still forming.
 *
 * A partial candle has a close that has not happened yet; leaving it in makes
 * the most recent signal unreproducible the moment the bar completes.
 */
export function dropUnclosedBar(bars: Bar[], timeframe: Timeframe, now = Date.now()): Bar[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  return last.time + TIMEFRAME_MS[timeframe] > now ? bars.slice(0, -1) : bars;
}

export { binanceSource } from "./binance";
export { yahooSource } from "./yahoo";
