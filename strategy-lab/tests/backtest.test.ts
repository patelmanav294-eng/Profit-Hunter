import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import { runBacktest, type BacktestConfig } from "../src/engine/backtest";
import type { Strategy } from "../src/engine/strategy";
import { emaCrossover } from "../src/strategies/presets";
import { bars, flat, noCosts, testInstrument } from "./helpers";

const baseConfig: BacktestConfig = {
  instrument: testInstrument,
  costs: noCosts,
  initialBalance: 10_000,
};

/** Enters long on every bar it can, with no exit rule of its own. */
const alwaysLong: Strategy = {
  name: "Always Long",
  indicators: [],
  long: { entry: { type: "always" } },
  sizing: { mode: "fixedLot", lots: 1 },
};

describe("execution timing", () => {
  it("fills an entry at the OPEN of the bar after the signal", () => {
    const data = bars([flat(100), [110, 110, 110, 110], flat(120), flat(130)]);
    const result = runBacktest(data, alwaysLong, baseConfig);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    // Signal fires on bar 0's close; bar 1 opens at 110.
    expect(trade.entryBarIndex).toBe(1);
    expect(trade.entryPrice).toBe(110);
    expect(trade.exitReason).toBe("endOfData");
    expect(trade.exitPrice).toBe(130);
    expect(trade.netProfit).toBeCloseTo(20, 10);
  });

  it("never uses a bar the signal could not have seen", () => {
    // Running over more data must not change trades that already closed. If the
    // engine peeked forward, extending the history would rewrite the past.
    const data = generateBars({ bars: 900, startPrice: 1.2, volatility: 0.004, seed: 21 });
    const config: BacktestConfig = {
      instrument: testInstrument,
      costs: { spreadPips: 0.0002, commissionPerLotPerSide: 0, slippagePips: 0 },
      initialBalance: 10_000,
    };

    const full = runBacktest(data, emaCrossover, config);
    const cut = 500;
    const truncated = runBacktest(data.slice(0, cut), emaCrossover, config);

    // Ignore the final trade of the short run — it was force-closed by the data
    // ending, which is an artefact of truncation rather than a decision.
    const settled = truncated.trades.filter(t => t.exitReason !== "endOfData");
    expect(settled.length).toBeGreaterThan(3);

    for (const trade of settled) {
      const match = full.trades.find(t => t.entryBarIndex === trade.entryBarIndex);
      expect(match, `trade entered at bar ${trade.entryBarIndex} vanished from the longer run`).toBeDefined();
      expect(match!.entryPrice).toBeCloseTo(trade.entryPrice, 10);
      expect(match!.exitBarIndex).toBe(trade.exitBarIndex);
      expect(match!.exitPrice).toBeCloseTo(trade.exitPrice, 10);
      expect(match!.netProfit).toBeCloseTo(trade.netProfit, 8);
    }
  });
});

describe("the entry bar's own range is not yet known when it fills", () => {
  /**
   * The fill happens at bar k's OPEN. Bar k's high, low and close have not
   * happened yet at that instant, so nothing about the position — stop
   * distance, target, or size — may depend on them.
   *
   * The truncation test cannot catch this: it removes bars AFTER k, and an
   * engine reading ATR[k] agrees with itself in both runs. Perturbing bar k's
   * own range is what exposes it.
   */
  const atrStop: Strategy = {
    name: "ATR Stop",
    indicators: [{ id: "atr14", type: "atr", period: 14 }],
    long: { entry: { type: "always" } },
    stopLoss: { mode: "atr", multiple: 2, atrId: "atr14" },
    sizing: { mode: "riskPercent", percent: 1 },
  };

  const data = generateBars({ bars: 300, startPrice: 100, volatility: 0.01, seed: 77 });
  const original = runBacktest(data, atrStop, baseConfig);
  const firstTrade = original.trades[0];

  it("has a trade with a stop to inspect", () => {
    expect(firstTrade).toBeDefined();
    expect(firstTrade.initialStopLoss).toBeDefined();
  });

  it("keeps the stop, target and size unchanged when only the entry bar's range moves", () => {
    const k = firstTrade.entryBarIndex;
    const entryBar = data[k];

    // Widen bar k dramatically while leaving its open — the fill price — alone.
    const perturbed = data.map((bar, index) =>
      index === k
        ? {
            ...bar,
            high: Math.max(entryBar.high, entryBar.open) * 1.05,
            low: Math.min(entryBar.low, entryBar.open) * 0.95,
          }
        : bar,
    );

    const rerun = runBacktest(perturbed, atrStop, baseConfig);
    const match = rerun.trades.find(t => t.entryBarIndex === k);

    expect(match, "the trade entering on the perturbed bar disappeared").toBeDefined();
    expect(match!.entryPrice).toBeCloseTo(firstTrade.entryPrice, 10);
    expect(
      match!.initialStopLoss,
      "stop distance moved with the entry bar's own range — it was sized from information that did not exist yet",
    ).toBeCloseTo(firstTrade.initialStopLoss!, 10);
    expect(match!.lots).toBeCloseTo(firstTrade.lots, 10);
  });
});

describe("transaction costs", () => {
  it("charges exactly one full spread per round trip", () => {
    const data = bars([flat(100), flat(110), flat(120), flat(130)]);
    const result = runBacktest(data, alwaysLong, {
      ...baseConfig,
      costs: { spreadPips: 2, commissionPerLotPerSide: 0, slippagePips: 0 },
    });

    const trade = result.trades[0];
    // pipSize is 1 here, so half the 2-pip spread is 1 price unit each side.
    expect(trade.entryPrice).toBe(111);
    expect(trade.exitPrice).toBe(129);
    expect(trade.netProfit).toBeCloseTo(18, 10);
  });

  it("charges commission on both sides of the trade", () => {
    const data = bars([flat(100), flat(110), flat(120), flat(130)]);
    const result = runBacktest(data, alwaysLong, {
      ...baseConfig,
      costs: { spreadPips: 0, commissionPerLotPerSide: 3.5, slippagePips: 0 },
    });

    const trade = result.trades[0];
    expect(trade.commission).toBeCloseTo(7, 10);
    expect(trade.grossProfit).toBeCloseTo(20, 10);
    expect(trade.netProfit).toBeCloseTo(13, 10);
  });
});

describe("stops and targets", () => {
  const withStop: Strategy = {
    name: "Stop Test",
    indicators: [],
    long: { entry: { type: "always" } },
    stopLoss: { mode: "pips", value: 10 },
    sizing: { mode: "riskPercent", percent: 1 },
  };

  it("sizes the position so the stop costs exactly the risk budget", () => {
    const data = bars([flat(100), flat(100), [95, 96, 85, 88], flat(88)]);
    const result = runBacktest(data, withStop, baseConfig);

    const trade = result.trades[0];
    // 1% of 10,000 = 100 risk; a 10-unit stop on a 1-unit contract → 10 lots.
    expect(trade.lots).toBeCloseTo(10, 10);
    expect(trade.initialStopLoss).toBeCloseTo(90, 10);
    expect(trade.exitReason).toBe("stopLoss");
    expect(trade.exitPrice).toBeCloseTo(90, 10);
    expect(trade.netProfit).toBeCloseTo(-100, 10);
    expect(trade.rMultiple).toBeCloseTo(-1, 10);
  });

  it("fills at the open when price gaps straight through the stop", () => {
    const data = bars([flat(100), flat(100), [85, 86, 84, 85], flat(85)]);
    const result = runBacktest(data, withStop, baseConfig);

    const trade = result.trades[0];
    // The stop was at 90 but the bar opened at 85 — no fill happens in the gap.
    expect(trade.exitPrice).toBeCloseTo(85, 10);
    expect(trade.netProfit).toBeCloseTo(-150, 10);
    expect(trade.rMultiple).toBeCloseTo(-1.5, 10);
  });

  it("assumes the stop filled first when one bar touches both levels", () => {
    const ambiguous: Strategy = {
      ...withStop,
      takeProfit: { mode: "riskReward", ratio: 1 },
    };
    const data = bars([flat(100), flat(100), [100, 115, 85, 100], flat(100)]);

    const pessimistic = runBacktest(data, ambiguous, baseConfig);
    expect(pessimistic.trades[0].exitReason).toBe("stopLoss");
    expect(pessimistic.trades[0].netProfit).toBeCloseTo(-100, 10);

    const optimistic = runBacktest(data, ambiguous, { ...baseConfig, intrabarPriority: "optimistic" });
    expect(optimistic.trades[0].exitReason).toBe("takeProfit");
    expect(optimistic.trades[0].netProfit).toBeCloseTo(100, 10);
  });

  it("can stop out on the entry bar itself", () => {
    const data = bars([flat(100), [100, 101, 85, 90], flat(90), flat(90)]);
    const result = runBacktest(data, withStop, baseConfig);

    expect(result.trades[0].entryBarIndex).toBe(1);
    expect(result.trades[0].exitBarIndex).toBe(1);
    expect(result.trades[0].exitReason).toBe("stopLoss");
  });

  it("places a risk-reward target at the right multiple of the stop distance", () => {
    const strategy: Strategy = { ...withStop, takeProfit: { mode: "riskReward", ratio: 2 } };
    const data = bars([flat(100), flat(100), [105, 125, 104, 120], flat(120)]);
    const result = runBacktest(data, strategy, baseConfig);

    const trade = result.trades[0];
    expect(trade.takeProfit).toBeCloseTo(120, 10);
    expect(trade.exitReason).toBe("takeProfit");
    expect(trade.rMultiple).toBeCloseTo(2, 10);
  });
});

describe("trailing stop", () => {
  it("ratchets in the trade's favour and never back", () => {
    const strategy: Strategy = {
      name: "Trail Test",
      indicators: [],
      long: { entry: { type: "always" } },
      trailingStop: { mode: "pips", value: 10 },
      sizing: { mode: "fixedLot", lots: 1 },
    };

    const data = bars([
      flat(100),
      flat(100), // entry at 100, trail seeds to 90
      [105, 110, 105, 110], // close 110 → trail moves up to 100
      [108, 108, 95, 100], // low 95 crosses the trail at 100 → exit there
      flat(100),
    ]);

    const result = runBacktest(data, strategy, baseConfig);
    const trade = result.trades[0];
    expect(trade.exitReason).toBe("trailingStop");
    expect(trade.exitPrice).toBeCloseTo(100, 10);
    expect(trade.netProfit).toBeCloseTo(0, 10);
  });
});

describe("position management", () => {
  it("closes a position that overstays maxBarsInTrade", () => {
    const strategy: Strategy = {
      name: "Time Stop",
      indicators: [],
      long: { entry: { type: "always" } },
      sizing: { mode: "fixedLot", lots: 1 },
      maxBarsInTrade: 2,
    };
    const data = bars([flat(100), flat(100), flat(101), flat(102), flat(103), flat(104)]);
    const result = runBacktest(data, strategy, baseConfig);

    const trade = result.trades[0];
    expect(trade.exitReason).toBe("maxBars");
    expect(trade.barsHeld).toBe(2);
  });

  it("holds only one position at a time", () => {
    const data = generateBars({ bars: 300, startPrice: 100, seed: 5 });
    const result = runBacktest(data, alwaysLong, baseConfig);

    const sorted = [...result.trades].sort((a, b) => a.entryBarIndex - b.entryBarIndex);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].entryBarIndex).toBeGreaterThanOrEqual(sorted[i - 1].exitBarIndex);
    }
  });

  it("respects the cooldown between trades", () => {
    const strategy: Strategy = {
      name: "Cooldown",
      indicators: [],
      long: { entry: { type: "always" } },
      stopLoss: { mode: "pips", value: 5 },
      sizing: { mode: "fixedLot", lots: 1 },
      cooldownBars: 3,
    };
    const data = generateBars({ bars: 300, startPrice: 100, volatility: 0.02, seed: 8 });
    const result = runBacktest(data, strategy, baseConfig);

    expect(result.trades.length).toBeGreaterThan(2);
    for (let i = 1; i < result.trades.length; i++) {
      const gap = result.trades[i].entryBarIndex - result.trades[i - 1].exitBarIndex;
      expect(gap).toBeGreaterThan(3);
    }
  });

  it("only enters inside the configured session window", () => {
    const strategy: Strategy = {
      name: "London Only",
      indicators: [],
      long: { entry: { type: "always" } },
      stopLoss: { mode: "pips", value: 5 },
      sizing: { mode: "fixedLot", lots: 1 },
      sessionUtc: { startHour: 7, endHour: 11 },
    };
    const data = generateBars({ bars: 500, startPrice: 100, volatility: 0.02, seed: 12 });
    const result = runBacktest(data, strategy, baseConfig);

    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      const hour = new Date(trade.entryTime).getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(7);
      expect(hour).toBeLessThan(11);
    }
  });

  it("skips a signal it cannot size above the minimum lot", () => {
    const strategy: Strategy = {
      name: "Too Small",
      indicators: [],
      long: { entry: { type: "always" } },
      stopLoss: { mode: "pips", value: 10 },
      sizing: { mode: "riskPercent", percent: 0.0001 },
      cooldownBars: 0,
    };
    const data = bars([flat(100), flat(100), flat(101), flat(102)]);
    const result = runBacktest(data, strategy, { ...baseConfig, initialBalance: 100 });

    expect(result.trades).toHaveLength(0);
    expect(result.skippedForSize).toBeGreaterThan(0);
  });
});

describe("short trades", () => {
  it("profits when price falls and pays the spread the same way", () => {
    const shortOnly: Strategy = {
      name: "Always Short",
      indicators: [],
      short: { entry: { type: "always" } },
      sizing: { mode: "fixedLot", lots: 1 },
    };
    const data = bars([flat(100), flat(100), flat(90), flat(80)]);
    const result = runBacktest(data, shortOnly, {
      ...baseConfig,
      costs: { spreadPips: 2, commissionPerLotPerSide: 0, slippagePips: 0 },
    });

    const trade = result.trades[0];
    expect(trade.direction).toBe("short");
    // Sell fills below mid, buy-back fills above it — one full spread again.
    expect(trade.entryPrice).toBe(99);
    expect(trade.exitPrice).toBe(81);
    expect(trade.netProfit).toBeCloseTo(18, 10);
  });
});

describe("input validation", () => {
  it("rejects bars that are out of order", () => {
    const data = bars([flat(100), flat(101), flat(102)]);
    const swapped = [data[0], data[2], data[1]];
    expect(() => runBacktest(swapped, alwaysLong, baseConfig)).toThrow(/ascending time/);
  });

  it("rejects duplicate timestamps", () => {
    const data = bars([flat(100), flat(101)]);
    const duplicated = [data[0], { ...data[1], time: data[0].time }];
    expect(() => runBacktest(duplicated, alwaysLong, baseConfig)).toThrow(/ascending time/);
  });

  it("reports every problem with an invalid strategy at once", () => {
    const broken: Strategy = {
      name: "Broken",
      indicators: [{ id: "ema20", type: "ema", period: 20 }],
      long: { entry: { type: "gt", left: { kind: "indicator", id: "typo" }, right: { kind: "const", value: 1 } } },
      takeProfit: { mode: "riskReward", ratio: 2 },
      sizing: { mode: "riskPercent", percent: 1 },
    };
    const data = bars([flat(100), flat(101), flat(102)]);

    expect(() => runBacktest(data, broken, baseConfig)).toThrow(/Unknown indicator "typo"/);
    // The same throw should also carry the two missing-stopLoss problems.
    expect(() => runBacktest(data, broken, baseConfig)).toThrow(/riskReward target needs a stopLoss/);
  });

  it("needs at least two bars", () => {
    expect(() => runBacktest(bars([flat(100)]), alwaysLong, baseConfig)).toThrow(/at least 2 bars/);
  });
});

describe("equity curve", () => {
  it("has one point per bar and tracks the running drawdown", () => {
    const data = generateBars({ bars: 250, startPrice: 100, seed: 4 });
    const result = runBacktest(data, emaCrossover, baseConfig);

    expect(result.equityCurve).toHaveLength(data.length);
    for (const point of result.equityCurve) {
      expect(point.drawdown).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(point.equity)).toBe(true);
    }
  });

  it("ends at the initial balance plus the sum of every trade", () => {
    const data = generateBars({ bars: 400, startPrice: 100, volatility: 0.01, seed: 6 });
    const result = runBacktest(data, emaCrossover, baseConfig);

    const summed = result.trades.reduce((total, t) => total + t.netProfit, baseConfig.initialBalance);
    const finalEquity = result.equityCurve[result.equityCurve.length - 1].equity;
    expect(finalEquity).toBeCloseTo(summed, 6);
  });
});

describe("sanity: no free money on random data", () => {
  /**
   * Zero-drift data contains no edge, so a correct engine should return
   * something statistically indistinguishable from zero (minus costs).
   *
   * The assertion has to be a statistical one. Single-run results on this data
   * span tens of percent either way, so "the mean is under 1%" would be a coin
   * flip rather than a check on anything. Instead the sample's own standard
   * error sets the tolerance: a systematic look-ahead leak would push the mean
   * far outside it, while ordinary noise stays within.
   */
  const runs = 30;
  const results = Array.from({ length: runs }, (_, i) =>
    runBacktest(generateBars({ bars: 1500, startPrice: 100, volatility: 0.006, seed: 500 + i }), emaCrossover, {
      instrument: testInstrument,
      costs: { spreadPips: 0.02, commissionPerLotPerSide: 0, slippagePips: 0 },
      initialBalance: 10_000,
    }),
  );
  const returns = results.map(r => r.metrics.netProfitPercent);

  it("produces a mean return within noise of zero", () => {
    const mean = returns.reduce((a, b) => a + b, 0) / runs;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (runs - 1);
    const standardError = Math.sqrt(variance / runs);

    expect(standardError).toBeGreaterThan(0);
    expect(
      Math.abs(mean),
      `mean ${mean.toFixed(2)}% is more than 3 standard errors (${standardError.toFixed(2)}%) from zero`,
    ).toBeLessThan(3 * standardError);
  });

  it("wins about as often as it loses", () => {
    // A leak would show up as nearly every run landing in profit.
    const profitable = returns.filter(r => r > 0).length;
    expect(profitable).toBeGreaterThan(runs * 0.2);
    expect(profitable).toBeLessThan(runs * 0.8);
  });

  it("actually traded in every run, so the result is not an empty sample", () => {
    for (const result of results) {
      expect(result.metrics.totalTrades).toBeGreaterThan(0);
    }
  });
});
