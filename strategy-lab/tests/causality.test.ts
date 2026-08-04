/**
 * The look-ahead guard for indicators.
 *
 * If the value at bar `i` depends only on bars `0..i`, then computing the
 * indicator over a truncated history must reproduce the full-history result
 * exactly, element for element, over the shared prefix. Any peek at a future
 * bar changes an earlier value and the comparison fails.
 *
 * This runs over every indicator in the library, so a new one that reaches
 * forward is caught here rather than in a live account.
 */

import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import * as ind from "../src/engine/indicators";
import type { Bar, Series } from "../src/engine/types";

const sample = generateBars({ bars: 400, startPrice: 1.1, volatility: 0.003, seed: 7 });
const closes = sample.map(b => b.close);

type SeriesFn = (bars: Bar[]) => Series;

const INDICATORS: Record<string, SeriesFn> = {
  "sma(20)": b => ind.sma(b.map(x => x.close), 20),
  "ema(20)": b => ind.ema(b.map(x => x.close), 20),
  "ema(200)": b => ind.ema(b.map(x => x.close), 200),
  "rsi(14)": b => ind.rsi(b.map(x => x.close), 14),
  "atr(14)": b => ind.atr(b, 14),
  "adx(14)": b => ind.adx(b, 14),
  "plusDI(14)": b => ind.directionalIndicators(b, 14).plusDI,
  "minusDI(14)": b => ind.directionalIndicators(b, 14).minusDI,
  "macd.line": b => ind.macd(b.map(x => x.close), 12, 26, 9).macd,
  "macd.signal": b => ind.macd(b.map(x => x.close), 12, 26, 9).signal,
  "macd.histogram": b => ind.macd(b.map(x => x.close), 12, 26, 9).histogram,
  "bbands.upper": b => ind.bollinger(b.map(x => x.close), 20, 2).upper,
  "bbands.middle": b => ind.bollinger(b.map(x => x.close), 20, 2).middle,
  "bbands.lower": b => ind.bollinger(b.map(x => x.close), 20, 2).lower,
  "stoch.k": b => ind.stochastic(b, 14, 3, 3).k,
  "stoch.d": b => ind.stochastic(b, 14, 3, 3).d,
  "supertrend.line": b => ind.supertrend(b, 10, 3).line,
  "supertrend.direction": b => ind.supertrend(b, 10, 3).direction,
  "supertrend.line(7,2)": b => ind.supertrend(b, 7, 2).line,
  "highest(20)": b => ind.highest(b.map(x => x.high), 20),
  "lowest(20)": b => ind.lowest(b.map(x => x.low), 20),
  "trueRange": b => ind.trueRange(b),
};

const TRUNCATIONS = [30, 60, 120, 199, 250, 333, 399];

describe("indicator causality", () => {
  for (const [name, compute] of Object.entries(INDICATORS)) {
    it(`${name} never reads a future bar`, () => {
      const full = compute(sample);

      for (const cut of TRUNCATIONS) {
        const truncated = compute(sample.slice(0, cut));
        expect(truncated.length).toBe(cut);
        expect(truncated, `${name} changed its first ${cut} values when later bars were removed`).toEqual(
          full.slice(0, cut),
        );
      }
    });
  }
});

describe("indicator output shape", () => {
  for (const [name, compute] of Object.entries(INDICATORS)) {
    it(`${name} returns a series aligned with the bars`, () => {
      const result = compute(sample);
      expect(result.length).toBe(sample.length);
      for (const value of result) {
        if (value === undefined) continue;
        expect(Number.isFinite(value), `${name} produced a non-finite value`).toBe(true);
      }
    });

    it(`${name} publishes values in one unbroken run`, () => {
      // A hole in the middle would mean a bar silently has no value while later
      // ones do, which every consumer here assumes cannot happen.
      const result = compute(sample);
      const firstDefined = result.findIndex(v => v !== undefined);
      if (firstDefined === -1) return;
      for (let i = firstDefined; i < result.length; i++) {
        expect(result[i], `${name} has a gap at index ${i}`).toBeDefined();
      }
    });
  }
});

describe("synthetic generator", () => {
  it("is deterministic for a given seed", () => {
    const a = generateBars({ bars: 50, startPrice: 100, seed: 99 });
    const b = generateBars({ bars: 50, startPrice: 100, seed: 99 });
    expect(a).toEqual(b);
  });

  it("produces different paths for different seeds", () => {
    const a = generateBars({ bars: 50, startPrice: 100, seed: 1 });
    const b = generateBars({ bars: 50, startPrice: 100, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("emits bars whose high and low contain the open and close", () => {
    for (const bar of sample) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
    }
  });

  it("emits strictly increasing timestamps", () => {
    for (let i = 1; i < sample.length; i++) {
      expect(sample[i].time).toBeGreaterThan(sample[i - 1].time);
    }
  });

  it("skips weekends when asked", () => {
    const weekdaysOnly = generateBars({ bars: 200, startPrice: 100, skipWeekends: true, seed: 3 });
    for (const bar of weekdaysOnly) {
      const day = new Date(bar.time).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("has no expected return when drift is zero", () => {
    // The whole point of the noise baseline is that there is nothing to find in
    // it. Without the convexity correction, exponentiating zero-mean shocks
    // drifts prices upward by σ²/2 per bar and the baseline flatters every
    // strategy compared against it.
    const runs = 300;
    const barsPerRun = 500;
    const volatility = 0.004;

    const finalRatios = Array.from({ length: runs }, (_, i) => {
      const path = generateBars({ bars: barsPerRun, startPrice: 100, volatility, seed: 2000 + i });
      return path[path.length - 1].close / 100;
    });

    const meanRatio = finalRatios.reduce((a, b) => a + b, 0) / runs;
    // Standard error of the mean terminal ratio is roughly σ·√bars/√runs.
    const standardError = (volatility * Math.sqrt(barsPerRun)) / Math.sqrt(runs);
    expect(Math.abs(meanRatio - 1)).toBeLessThan(4 * standardError);
  });

  it("respects a deliberate drift", () => {
    const drifting = generateBars({ bars: 2000, startPrice: 100, volatility: 0.001, drift: 0.001, seed: 77 });
    expect(drifting[drifting.length - 1].close).toBeGreaterThan(100);
  });

  it("keeps closes positive over a long run", () => {
    const long = generateBars({ bars: 5000, startPrice: 1.1, volatility: 0.005, seed: 11 });
    expect(closes.length).toBe(400);
    for (const bar of long) expect(bar.close).toBeGreaterThan(0);
  });
});
