/**
 * Yahoo Finance chart endpoint — FX, indices, equities, commodities.
 *
 * Undocumented and unversioned, so it can change without notice. History depth
 * is also tiered: intraday intervals only go back a matter of days.
 */

import type { Bar } from "../../engine/types";
import { dropUnclosedBar, type FetchRequest, type MarketDataSource, type Timeframe } from "./index";

const INTERVALS: Record<Timeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "1h", // Yahoo has no 4h; hourly bars are fetched and aggregated below.
  D1: "1d",
  W1: "1wk",
};

/** How far back Yahoo will serve each interval. */
const MAX_RANGE: Record<string, string> = {
  "1m": "7d",
  "5m": "60d",
  "15m": "60d",
  "30m": "60d",
  "1h": "730d",
  "1d": "10y",
  "1wk": "10y",
};

/**
 * Suggests a working ticker for symbols people reasonably expect to exist.
 *
 * Yahoo carries gold and silver as futures contracts, not as spot FX pairs —
 * `XAUUSD=X` looks like it should work alongside `EURUSD=X` and simply 404s.
 */
export function suggestSymbol(symbol: string): string | undefined {
  const upper = symbol.toUpperCase();

  if (upper.includes("XAU") || upper.startsWith("GOLD")) {
    return "GC=F for gold futures, or GLD for the gold ETF — Yahoo has no spot-gold FX pair";
  }
  if (upper.includes("XAG") || upper.startsWith("SILVER")) {
    return "SI=F for silver futures, or SLV for the silver ETF";
  }
  if (upper.includes("WTI") || upper.includes("OIL")) {
    return "CL=F for WTI crude, or BZ=F for Brent";
  }
  // A bare six-letter currency pair needs the suffix Yahoo uses for FX.
  if (/^[A-Z]{6}$/.test(upper)) {
    return `${upper}=X — Yahoo FX tickers need the "=X" suffix`;
  }
  return undefined;
}

export const yahooSource: MarketDataSource = {
  id: "yahoo",
  label: "Yahoo Finance (FX, indices, stocks)",
  symbolHint:
    'FX pairs use an "=X" suffix: EURUSD=X, GBPJPY=X. Gold is GC=F (futures) or GLD (ETF), S&P 500 is ^GSPC.',

  async fetchBars(request: FetchRequest, fetchImpl: typeof fetch = fetch): Promise<Bar[]> {
    const interval = INTERVALS[request.timeframe];
    const range = MAX_RANGE[interval] ?? "1y";
    const symbol = encodeURIComponent(request.symbol);

    const response = await fetchImpl(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`,
      {
        // Yahoo rejects requests without a browser-shaped User-Agent, and the
        // 403 it returns looks identical to a bad ticker.
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new Error(
          `Yahoo returned ${response.status} for ${request.symbol} — rate-limited or blocked; wait a minute and retry`,
        );
      }
      const suggestion = suggestSymbol(request.symbol);
      throw new Error(
        `Yahoo has no ticker "${request.symbol}" (HTTP ${response.status})` +
          (suggestion ? `. Try ${suggestion}` : " — check the spelling"),
      );
    }

    const payload = (await response.json()) as YahooResponse;
    const result = payload.chart?.result?.[0];
    if (!result) {
      const message = payload.chart?.error?.description ?? "no data in response";
      throw new Error(`Yahoo had nothing for ${request.symbol}: ${message}`);
    }

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    if (!quote) throw new Error(`Yahoo returned no OHLC series for ${request.symbol}`);

    const bars: Bar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      // Yahoo pads holidays and halts with nulls; those are gaps, not bars.
      if (open == null || high == null || low == null || close == null) continue;
      bars.push({ time: timestamps[i] * 1000, open, high, low, close, volume: quote.volume?.[i] ?? undefined });
    }

    const shaped = request.timeframe === "H4" ? aggregate(bars, 4) : bars;
    const trimmed = shaped.slice(-request.limit);
    return dropUnclosedBar(trimmed, request.timeframe);
  },
};

/** Merges every `factor` consecutive bars into one. */
export function aggregate(bars: Bar[], factor: number): Bar[] {
  if (factor <= 1) return bars;
  const out: Bar[] = [];

  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    // Drop a trailing partial group so the last bar is not a short candle
    // masquerading as a full one.
    if (chunk.length < factor) break;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, b) => sum + (b.volume ?? 0), 0),
    });
  }
  return out;
}

interface YahooResponse {
  chart?: {
    error?: { description?: string };
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
}
