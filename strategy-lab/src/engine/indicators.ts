/**
 * Indicator library.
 *
 * THE ONE RULE: the value at index `i` may only depend on bars `0..i`.
 * Break it and the backtest silently trades on information it could not have
 * had, which is the single most common way a backtest lies to you. The suite in
 * `tests/causality.test.ts` enforces this mechanically for every indicator by
 * recomputing on truncated inputs and demanding identical prefixes — so a
 * future indicator that peeks ahead fails the build rather than the live account.
 *
 * All functions return a `Series` aligned 1:1 with the input, using `undefined`
 * for bars before the indicator has warmed up.
 */

import type { Bar, PriceField, Series } from "./types";

export function priceSeries(bars: Bar[], field: PriceField): number[] {
  return bars.map(b => b[field]);
}

/** Typical price (H+L+C)/3 — the usual source for CCI-style calculations. */
export function typicalPrice(bars: Bar[]): number[] {
  return bars.map(b => (b.high + b.low + b.close) / 3);
}

export function sma(values: number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);

  // Seed with a simple average so the first published value is not an artefact
  // of an arbitrary starting point.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that may have leading `undefined` values (e.g. a MACD line). */
export function emaOfSeries(values: Series, period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  const k = 2 / (period + 1);
  let seedCount = 0;
  let seedSum = 0;
  let prev: number | undefined;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    if (prev === undefined) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = (v - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's smoothing (the "RMA" used by RSI, ATR and ADX).
 * Seeds with a simple average of the first `period` values, then applies
 * `next = (prev * (period - 1) + current) / period`.
 */
export function wilderSmooth(values: number[], period: number, startIndex = 0): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  const seedEnd = startIndex + period - 1;
  if (seedEnd >= values.length) return out;

  let sum = 0;
  for (let i = startIndex; i <= seedEnd; i++) sum += values[i];
  let prev = sum / period;
  out[seedEnd] = prev;

  for (let i = seedEnd + 1; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;

  const gains: number[] = new Array(values.length).fill(0);
  const losses: number[] = new Array(values.length).fill(0);
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    gains[i] = change > 0 ? change : 0;
    losses[i] = change < 0 ? -change : 0;
  }

  // Changes only exist from index 1, so the smoothing window starts there.
  const avgGain = wilderSmooth(gains, period, 1);
  const avgLoss = wilderSmooth(losses, period, 1);

  for (let i = 0; i < values.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g === undefined || l === undefined) continue;
    // A window with no down-closes has infinite relative strength; RSI pins to 100.
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function trueRange(bars: Bar[]): number[] {
  const out = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0) {
      out[i] = b.high - b.low;
      continue;
    }
    const prevClose = bars[i - 1].close;
    out[i] = Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  }
  return out;
}

export function atr(bars: Bar[], period: number): Series {
  return wilderSmooth(trueRange(bars), period);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: number[], fast: number, slow: number, signalPeriod: number): MacdResult {
  if (fast >= slow) throw new Error(`MACD needs fast (${fast}) < slow (${slow})`);
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);

  const macdLine: Series = values.map((_, i) => {
    const f = fastLine[i];
    const s = slowLine[i];
    return f === undefined || s === undefined ? undefined : f - s;
  });

  const signal = emaOfSeries(macdLine, signalPeriod);
  const histogram: Series = macdLine.map((m, i) => {
    const s = signal[i];
    return m === undefined || s === undefined ? undefined : m - s;
  });

  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(values: number[], period: number, stdDevMultiplier: number): BollingerResult {
  assertPeriod(period);
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(undefined);
  const lower: Series = new Array(values.length).fill(undefined);

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === undefined) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - mean;
      variance += diff * diff;
    }
    // Population standard deviation — the convention every charting package uses.
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + sd * stdDevMultiplier;
    lower[i] = mean - sd * stdDevMultiplier;
  }

  return { upper, middle, lower };
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

export function stochastic(bars: Bar[], kPeriod: number, smooth: number, dPeriod: number): StochasticResult {
  assertPeriod(kPeriod);
  const rawK: Series = new Array(bars.length).fill(undefined);

  for (let i = kPeriod - 1; i < bars.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low < lowest) lowest = bars[j].low;
    }
    const range = highest - lowest;
    // A perfectly flat window has no range to normalise against; 50 is the
    // neutral reading every implementation falls back to.
    rawK[i] = range === 0 ? 50 : ((bars[i].close - lowest) / range) * 100;
  }

  const k = smooth > 1 ? smaOfSeries(rawK, smooth) : rawK;
  const d = smaOfSeries(k, dPeriod);
  return { k, d };
}

export function adx(bars: Bar[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(bars.length).fill(undefined);
  if (bars.length < period * 2) return out;

  const plusDM: number[] = new Array(bars.length).fill(0);
  const minusDM: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    // Only the larger of the two directional moves counts, and only if positive.
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const tr = trueRange(bars);
  const smoothedTR = wilderSmooth(tr, period, 1);
  const smoothedPlus = wilderSmooth(plusDM, period, 1);
  const smoothedMinus = wilderSmooth(minusDM, period, 1);

  const dx: number[] = new Array(bars.length).fill(0);
  let firstDxIndex = -1;
  for (let i = 0; i < bars.length; i++) {
    const t = smoothedTR[i];
    const p = smoothedPlus[i];
    const m = smoothedMinus[i];
    if (t === undefined || p === undefined || m === undefined || t === 0) continue;
    const plusDI = (p / t) * 100;
    const minusDI = (m / t) * 100;
    const sum = plusDI + minusDI;
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
    if (firstDxIndex === -1) firstDxIndex = i;
  }
  if (firstDxIndex === -1) return out;

  // ADX is Wilder smoothing applied a second time, over the DX series.
  const smoothedDx = wilderSmooth(dx, period, firstDxIndex);
  for (let i = 0; i < bars.length; i++) out[i] = smoothedDx[i];
  return out;
}

export interface SupertrendResult {
  /** The trailing line itself — sits below price in an uptrend, above in a downtrend. */
  line: Series;
  /** +1 while the trend is up, -1 while it is down. */
  direction: Series;
}

/**
 * Supertrend.
 *
 * An ATR band around the bar's midpoint that ratchets in the direction of the
 * trend and only flips when price closes through it.
 *
 * The two ratchet rules are what make it a trend filter rather than a rescaled
 * ATR: each band may only tighten towards price, and it resets when the
 * previous close broke through. Both compare against the PREVIOUS bar's final
 * band, never the current one, which is what keeps the whole thing causal.
 */
export function supertrend(bars: Bar[], period: number, multiplier: number): SupertrendResult {
  assertPeriod(period);
  const line: Series = new Array(bars.length).fill(undefined);
  const direction: Series = new Array(bars.length).fill(undefined);

  const atrSeries = atr(bars, period);
  let finalUpper: number | undefined;
  let finalLower: number | undefined;
  let trend: number | undefined;

  for (let i = 0; i < bars.length; i++) {
    const atrValue = atrSeries[i];
    if (atrValue === undefined) continue;

    const bar = bars[i];
    const midpoint = (bar.high + bar.low) / 2;
    const basicUpper = midpoint + multiplier * atrValue;
    const basicLower = midpoint - multiplier * atrValue;
    const previousClose = i > 0 ? bars[i - 1].close : bar.close;

    // Tighten towards price, or reset if the last close broke through.
    finalUpper =
      finalUpper === undefined || basicUpper < finalUpper || previousClose > finalUpper ? basicUpper : finalUpper;
    finalLower =
      finalLower === undefined || basicLower > finalLower || previousClose < finalLower ? basicLower : finalLower;

    if (trend === undefined) {
      // Seed from where price sits relative to the midpoint on the first bar
      // that has an ATR to work with. TradingView instead seeds unconditionally
      // into a downtrend, which can manufacture a spurious first flip; the two
      // converge as soon as price closes through a band, so expect a difference
      // only in the opening handful of bars when comparing against a chart.
      trend = bar.close >= midpoint ? 1 : -1;
    } else if (bar.close > finalUpper) {
      trend = 1;
    } else if (bar.close < finalLower) {
      trend = -1;
    }

    direction[i] = trend;
    line[i] = trend === 1 ? finalLower : finalUpper;
  }

  return { line, direction };
}

export interface DirectionalIndex {
  plusDI: Series;
  minusDI: Series;
}

export function directionalIndicators(bars: Bar[], period: number): DirectionalIndex {
  assertPeriod(period);
  const plusDM: number[] = new Array(bars.length).fill(0);
  const minusDM: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const smoothedTR = wilderSmooth(trueRange(bars), period, 1);
  const smoothedPlus = wilderSmooth(plusDM, period, 1);
  const smoothedMinus = wilderSmooth(minusDM, period, 1);

  const plusDI: Series = new Array(bars.length).fill(undefined);
  const minusDI: Series = new Array(bars.length).fill(undefined);
  for (let i = 0; i < bars.length; i++) {
    const t = smoothedTR[i];
    const p = smoothedPlus[i];
    const m = smoothedMinus[i];
    if (t === undefined || p === undefined || m === undefined || t === 0) continue;
    plusDI[i] = (p / t) * 100;
    minusDI[i] = (m / t) * 100;
  }
  return { plusDI, minusDI };
}

/** Highest high over a rolling window, inclusive of the current bar. */
export function highest(values: number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > max) max = values[j];
    out[i] = max;
  }
  return out;
}

/** Lowest low over a rolling window, inclusive of the current bar. */
export function lowest(values: number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < min) min = values[j];
    out[i] = min;
  }
  return out;
}

/** SMA over a series that may contain leading `undefined` values. */
export function smaOfSeries(values: Series, period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(undefined);
  const window: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    window.push(v);
    if (window.length > period) window.shift();
    if (window.length === period) {
      out[i] = window.reduce((a, b) => a + b, 0) / period;
    }
  }
  return out;
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`Indicator period must be a positive integer, got ${period}`);
  }
}
