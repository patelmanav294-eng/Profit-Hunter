import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import { runBacktest } from "../src/engine/backtest";
import { ema, supertrend } from "../src/engine/indicators";
import { validateStrategy } from "../src/engine/strategy";
import { conditionToText, parseRule } from "../src/strategies/parse";
import { DEFAULT_SUPERTREND_EMA, supertrendEmaStrategy } from "../src/strategies/supertrendEma";
import { bars, noCosts, testInstrument } from "./helpers";

/** A clean one-way rise, steep enough that Supertrend should never flip down. */
const rising = bars(
  Array.from({ length: 80 }, (_, i): [number, number, number, number] => [
    100 + i,
    101 + i,
    99.6 + i,
    100.9 + i,
  ]),
);

/** The same, falling. */
const falling = bars(
  Array.from({ length: 80 }, (_, i): [number, number, number, number] => [
    200 - i,
    200.4 - i,
    199 - i,
    199.1 - i,
  ]),
);

describe("supertrend", () => {
  it("returns a series aligned with the bars", () => {
    const result = supertrend(rising, 10, 3);
    expect(result.line).toHaveLength(rising.length);
    expect(result.direction).toHaveLength(rising.length);
  });

  it("stays undefined until ATR has warmed up", () => {
    const result = supertrend(rising, 10, 3);
    // ATR(10) publishes its first value at index 9.
    expect(result.direction[8]).toBeUndefined();
    expect(result.direction[9]).toBeDefined();
  });

  it("reports +1 through a sustained uptrend", () => {
    const { direction } = supertrend(rising, 10, 3);
    for (let i = 20; i < rising.length; i++) {
      expect(direction[i], `bar ${i}`).toBe(1);
    }
  });

  it("reports -1 through a sustained downtrend", () => {
    const { direction } = supertrend(falling, 10, 3);
    for (let i = 20; i < falling.length; i++) {
      expect(direction[i], `bar ${i}`).toBe(-1);
    }
  });

  it("keeps the line below price in an uptrend and above it in a downtrend", () => {
    const up = supertrend(rising, 10, 3);
    for (let i = 20; i < rising.length; i++) {
      expect(up.line[i]!).toBeLessThan(rising[i].close);
    }

    const down = supertrend(falling, 10, 3);
    for (let i = 20; i < falling.length; i++) {
      expect(down.line[i]!).toBeGreaterThan(falling[i].close);
    }
  });

  it("ratchets the line upward while the trend holds", () => {
    // The band may only tighten towards price; it must never loosen mid-trend.
    const { line, direction } = supertrend(rising, 10, 3);
    for (let i = 21; i < rising.length; i++) {
      if (direction[i] !== 1 || direction[i - 1] !== 1) continue;
      expect(line[i]!, `bar ${i} loosened`).toBeGreaterThanOrEqual(line[i - 1]! - 1e-9);
    }
  });

  it("flips when price closes through the band", () => {
    // Rise, then collapse hard enough to close below the trailing line.
    const reversing = bars([
      ...Array.from({ length: 40 }, (_, i): [number, number, number, number] => [
        100 + i,
        101 + i,
        99.6 + i,
        100.9 + i,
      ]),
      ...Array.from({ length: 20 }, (_, i): [number, number, number, number] => [
        140 - i * 4,
        141 - i * 4,
        135 - i * 4,
        136 - i * 4,
      ]),
    ]);

    const { direction } = supertrend(reversing, 10, 3);
    expect(direction[39]).toBe(1);
    expect(direction[reversing.length - 1]).toBe(-1);
  });

  it("flips less often with a wider multiplier", () => {
    const choppy = generateBars({ bars: 1500, startPrice: 100, volatility: 0.006, seed: 91 });
    const countFlips = (multiplier: number) => {
      const { direction } = supertrend(choppy, 10, multiplier);
      let flips = 0;
      for (let i = 1; i < direction.length; i++) {
        if (direction[i] !== undefined && direction[i - 1] !== undefined && direction[i] !== direction[i - 1]) {
          flips++;
        }
      }
      return flips;
    };

    expect(countFlips(1.5)).toBeGreaterThan(countFlips(4));
  });

  it("only ever reports +1 or -1", () => {
    const noisy = generateBars({ bars: 800, startPrice: 100, volatility: 0.008, seed: 12 });
    for (const value of supertrend(noisy, 10, 3).direction) {
      if (value === undefined) continue;
      expect([1, -1]).toContain(value);
    }
  });
});

describe("supertrend in the rule parser", () => {
  it("defaults to the line with conventional periods", () => {
    expect(parseRule("close > supertrend").indicators[0]).toEqual({
      id: "st_line_10_3",
      type: "supertrend",
      period: 10,
      multiplier: 3,
      output: "line",
    });
  });

  it("parses the direction flag and explicit periods", () => {
    expect(parseRule("supertrend direction 7 2 > 0").indicators[0]).toMatchObject({
      output: "direction",
      period: 7,
      multiplier: 2,
    });
  });

  it("accepts dir/trend as aliases and st as shorthand", () => {
    expect(parseRule("st dir > 0").indicators[0]).toMatchObject({ output: "direction" });
    expect(parseRule("supertrend trend > 0").indicators[0]).toMatchObject({ output: "direction" });
  });

  it("round-trips through its own rendering", () => {
    const first = parseRule("supertrend direction 10 3 crosses above 0 and close > ema 200");
    const second = parseRule(conditionToText(first.condition, first.indicators));
    expect(second.condition).toEqual(first.condition);
  });
});

describe("supertrend + EMA strategy", () => {
  const strategy = supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA);

  it("is valid", () => {
    expect(validateStrategy(strategy)).toEqual([]);
  });

  it("trades both directions and uses a 1:2 risk-reward by default", () => {
    expect(strategy.long).toBeDefined();
    expect(strategy.short).toBeDefined();
    expect(strategy.takeProfit).toEqual({ mode: "riskReward", ratio: 2 });
  });

  it("enters on the flip bar rather than on every bar of a trend", () => {
    const data = generateBars({ bars: 3000, startPrice: 100, volatility: 0.005, seed: 44 });
    const result = runBacktest(data, strategy, {
      instrument: testInstrument,
      costs: noCosts,
      initialBalance: 10_000,
    });

    // A state-based rule would re-enter constantly; a flip-based one cannot
    // trade more often than the direction actually changes.
    const { direction } = supertrend(data, DEFAULT_SUPERTREND_EMA.stPeriod, DEFAULT_SUPERTREND_EMA.stMultiplier);
    let flips = 0;
    for (let i = 1; i < direction.length; i++) {
      if (direction[i] !== undefined && direction[i - 1] !== undefined && direction[i] !== direction[i - 1]) flips++;
    }

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.length).toBeLessThanOrEqual(flips);
  });

  it("never goes long below the EMA, or short above it", () => {
    const data = generateBars({ bars: 4000, startPrice: 100, volatility: 0.005, seed: 45 });
    const result = runBacktest(data, strategy, {
      instrument: testInstrument,
      costs: noCosts,
      initialBalance: 10_000,
    });

    const trendFilter = ema(
      data.map(b => b.close),
      DEFAULT_SUPERTREND_EMA.emaPeriod,
    );

    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      // The rule is evaluated on the bar BEFORE the fill, so that is the bar
      // whose close and EMA have to satisfy it.
      const signal = trade.entryBarIndex - 1;
      const filterValue = trendFilter[signal];
      expect(filterValue, `no EMA value at signal bar ${signal}`).toBeDefined();

      if (trade.direction === "long") {
        expect(data[signal].close, `long entered at bar ${trade.entryBarIndex} below the EMA`).toBeGreaterThan(
          filterValue!,
        );
      } else {
        expect(data[signal].close, `short entered at bar ${trade.entryBarIndex} above the EMA`).toBeLessThan(
          filterValue!,
        );
      }
    }
  });
});
