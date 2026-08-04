import { describe, expect, it } from "vitest";

import { inferIntervalMs, measureVolatility } from "../src/data/statistics";
import { generateBars } from "../src/data/synthetic";
import { runBacktest } from "../src/engine/backtest";
import type { Bar, Instrument } from "../src/engine/types";
import { INSTRUMENTS } from "../src/data/instruments";
import { DEFAULT_SUPERTREND_EMA, supertrendEmaStrategy } from "../src/strategies/supertrendEma";

describe("measureVolatility", () => {
  it("recovers the volatility the generator was given", () => {
    for (const target of [0.001, 0.005, 0.02]) {
      const bars = generateBars({ bars: 4000, startPrice: 100, volatility: target, seed: 3 });
      expect(measureVolatility(bars), `target ${target}`).toBeCloseTo(target, 3);
    }
  });

  it("is independent of the price level", () => {
    // The same proportional moves must measure the same at $1 and at $2,000,
    // which is the property the noise baseline relies on.
    const cheap = generateBars({ bars: 3000, startPrice: 1.1, volatility: 0.003, seed: 9 });
    const dear = generateBars({ bars: 3000, startPrice: 2400, volatility: 0.003, seed: 9 });
    expect(measureVolatility(cheap)).toBeCloseTo(measureVolatility(dear), 6);
  });

  it("falls back rather than returning zero for a flat or tiny series", () => {
    const flat: Bar[] = Array.from({ length: 50 }, (_, i) => ({
      time: i * 3_600_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }));
    expect(measureVolatility(flat)).toBe(0.002);
    expect(measureVolatility([])).toBe(0.002);
    expect(measureVolatility(flat.slice(0, 2))).toBe(0.002);
  });
});

describe("inferIntervalMs", () => {
  it("finds the bar spacing", () => {
    for (const interval of [60_000, 3_600_000, 14_400_000]) {
      const bars = generateBars({ bars: 200, startPrice: 100, intervalMs: interval, seed: 1 });
      expect(inferIntervalMs(bars)).toBe(interval);
    }
  });

  it("ignores weekend gaps by taking the median rather than the mean", () => {
    // A handful of 48-hour gaps would drag an average well past the true hour.
    const bars = generateBars({ bars: 400, startPrice: 100, intervalMs: 3_600_000, skipWeekends: true, seed: 2 });
    expect(inferIntervalMs(bars)).toBe(3_600_000);
  });

  it("falls back for a series too short to measure", () => {
    expect(inferIntervalMs([])).toBe(3_600_000);
  });
});

describe("a noise baseline has to match the instrument it stands in for", () => {
  /**
   * Regression test for a real bug: the CLI generated its comparison random
   * walks at a hard-coded price of 1.1 regardless of the data loaded. Against
   * $2,400 gold — where a pip is 0.01 — that charged the synthetic runs a
   * spread worth almost 1% of price per trade, and the baseline came back at
   * -35% with zero of fifty runs profitable. Nothing could fail to beat it.
   */
  const strategy = supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA);
  const gold: Instrument = INSTRUMENTS.XAUUSD;
  const costs = { spreadPips: 20, commissionPerLotPerSide: 0, slippagePips: 0 };

  const runAt = (startPrice: number): number => {
    const bars = generateBars({ bars: 6000, startPrice, volatility: 0.0022, drift: 0, seed: 55 });
    return runBacktest(bars, strategy, { instrument: gold, costs, initialBalance: 10_000 }).metrics
      .netProfitPercent;
  };

  it("costs stay proportionate when the price level is right", () => {
    // Zero-drift data with realistic costs should land near zero, not near ruin.
    const atGoldPrices = runAt(2400);
    expect(Math.abs(atGoldPrices)).toBeLessThan(25);
  });

  it("shows how badly a mismatched price level distorts the baseline", () => {
    // Same instrument spec, same costs, same strategy — only the price level
    // differs, and the result is unrecognisable. This is what the bug did.
    const atGoldPrices = runAt(2400);
    const atFxPrices = runAt(1.1);
    expect(atFxPrices).toBeLessThan(atGoldPrices - 20);
  });
});
