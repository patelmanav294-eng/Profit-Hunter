/**
 * Descriptive statistics measured from a bar series.
 *
 * These exist so a noise comparison can be built to match the real data. A
 * random walk generated at the wrong price level or the wrong volatility is not
 * a baseline — costs scale with price, so comparing $2,000 gold against a
 * random walk starting at 1.1000 charges the synthetic runs a spread hundreds
 * of times larger in relative terms and produces a baseline nothing could beat.
 */

import type { Bar } from "../engine/types";

/**
 * Standard deviation of per-bar log returns.
 *
 * Falls back to a plausible FX-like figure when the series is too short or
 * degenerate to measure, rather than returning zero and producing a flat
 * synthetic series.
 */
export function measureVolatility(bars: Bar[], fallback = 0.002): number {
  if (bars.length < 3) return fallback;

  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const previous = bars[i - 1].close;
    if (previous > 0 && bars[i].close > 0) returns.push(Math.log(bars[i].close / previous));
  }
  if (returns.length < 2) return fallback;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);

  return Number.isFinite(sd) && sd > 0 ? sd : fallback;
}

/**
 * Median spacing between bars, in milliseconds.
 *
 * The median rather than the mean because weekend and holiday gaps are large
 * and would drag an average well past the true bar interval.
 */
export function inferIntervalMs(bars: Bar[], fallback = 3_600_000): number {
  if (bars.length < 2) return fallback;

  const gaps: number[] = [];
  for (let i = 1; i < Math.min(bars.length, 500); i++) gaps.push(bars[i].time - bars[i - 1].time);
  gaps.sort((a, b) => a - b);

  const median = gaps[Math.floor(gaps.length / 2)];
  return median > 0 ? median : fallback;
}
