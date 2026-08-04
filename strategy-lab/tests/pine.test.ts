import { describe, expect, it } from "vitest";

import { strategyToPine } from "../src/export/pine";
import type { Strategy } from "../src/engine/strategy";
import { PRESETS } from "../src/strategies/presets";
import { DEFAULT_SUPERTREND_EMA, supertrendEmaStrategy } from "../src/strategies/supertrendEma";
import { noCosts, testInstrument } from "./helpers";

const options = { instrument: testInstrument, costs: noCosts, initialCapital: 10_000 };

describe("script shape", () => {
  const script = strategyToPine(supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA), options);

  it("declares the Pine version first", () => {
    expect(script.split("\n")[0]).toBe("//@version=5");
  });

  it("opens a strategy, not an indicator", () => {
    expect(script).toMatch(/^strategy\(/m);
  });

  it("keeps TradingView's fill timing aligned with the engine", () => {
    // Orders must fill at the next bar's open, which is what the engine models.
    expect(script).toContain("process_orders_on_close=false");
    expect(script).toContain("calc_on_every_tick=false");
  });

  it("holds one position at a time", () => {
    expect(script).toContain("pyramiding=0");
  });

  it("says where it will not match the backtest", () => {
    expect(script).toContain("the stop filled first");
  });
});

describe("supertrend direction convention", () => {
  const script = strategyToPine(supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA), options);

  it("flips TradingView's sign so +1 means up", () => {
    // ta.supertrend returns -1 for an UPTREND. Without this negation every long
    // and short condition would be inverted on the chart.
    expect(script).toMatch(/_direction = -\w+_tvdir/);
  });

  it("calls ta.supertrend with multiplier first, then period", () => {
    const { stPeriod, stMultiplier } = DEFAULT_SUPERTREND_EMA;
    expect(script).toContain(`ta.supertrend(${stMultiplier}, ${stPeriod})`);
  });

  it("routes the entry condition through the flipped variable", () => {
    expect(script).toMatch(/longSignal\s+= \(ta\.crossover\(\w+_direction, 0\)/);
    expect(script).toMatch(/shortSignal = \(ta\.crossunder\(\w+_direction, 0\)/);
  });
});

describe("indicator translation", () => {
  it("emits a shared tuple call once for MACD lines", () => {
    const strategy: Strategy = {
      name: "MACD",
      indicators: [
        { id: "m", type: "macd", fast: 12, slow: 26, signal: 9, output: "macd" },
        { id: "s", type: "macd", fast: 12, slow: 26, signal: 9, output: "signal" },
        { id: "h", type: "macd", fast: 12, slow: 26, signal: 9, output: "histogram" },
      ],
      long: { entry: { type: "crossesAbove", left: { kind: "indicator", id: "m" }, right: { kind: "indicator", id: "s" } } },
      sizing: { mode: "fixedLot", lots: 1 },
    };

    const script = strategyToPine(strategy, options);
    const calls = script.match(/ta\.macd\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(script).toContain("macd_12_26_9_line");
    expect(script).toContain("macd_12_26_9_signal");
  });

  it("emits one ta.dmi call for ADX and both DI lines", () => {
    const strategy: Strategy = {
      name: "DMI",
      indicators: [
        { id: "adx", type: "adx", period: 14 },
        { id: "plus", type: "plusDI", period: 14 },
        { id: "minus", type: "minusDI", period: 14 },
      ],
      long: { entry: { type: "gt", left: { kind: "indicator", id: "adx" }, right: { kind: "const", value: 25 } } },
      sizing: { mode: "fixedLot", lots: 1 },
    };

    const script = strategyToPine(strategy, options);
    expect((script.match(/ta\.dmi\(/g) ?? []).length).toBe(1);
    expect(script).toContain("dmi_14_adx");
  });

  it("maps Bollinger outputs onto ta.bb's tuple order", () => {
    const strategy: Strategy = {
      name: "BB",
      indicators: [
        { id: "u", type: "bbands", period: 20, stdDev: 2, output: "upper" },
        { id: "l", type: "bbands", period: 20, stdDev: 2, output: "lower" },
      ],
      long: { entry: { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "l" } } },
      sizing: { mode: "fixedLot", lots: 1 },
    };

    const script = strategyToPine(strategy, options);
    // ta.bb returns [middle, upper, lower] — the destructuring must match.
    expect(script).toMatch(/\[bb_20_2_middle, bb_20_2_upper, bb_20_2_lower\] = ta\.bb\(close, 20, 2\)/);
  });

  it("builds the stochastic %K and %D from smoothed ta.stoch", () => {
    const strategy: Strategy = {
      name: "Stoch",
      indicators: [
        { id: "k", type: "stoch", kPeriod: 14, smooth: 3, dPeriod: 3, output: "k" },
        { id: "d", type: "stoch", kPeriod: 14, smooth: 3, dPeriod: 3, output: "d" },
      ],
      long: { entry: { type: "crossesAbove", left: { kind: "indicator", id: "k" }, right: { kind: "indicator", id: "d" } } },
      sizing: { mode: "fixedLot", lots: 1 },
    };

    const script = strategyToPine(strategy, options);
    expect(script).toContain("ta.stoch(close, high, low, 14)");
    expect(script).toMatch(/stoch_14_3_3_d = ta\.sma\(stoch_14_3_3_k, 3\)/);
  });
});

describe("condition translation", () => {
  const build = (strategy: Partial<Strategy>): string =>
    strategyToPine(
      {
        name: "T",
        indicators: [{ id: "ema50", type: "ema", period: 50 }],
        sizing: { mode: "fixedLot", lots: 1 },
        ...strategy,
      } as Strategy,
      options,
    );

  it("maps crossovers to ta.crossover and ta.crossunder", () => {
    const above = build({
      long: { entry: { type: "crossesAbove", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "ema50" } } },
    });
    expect(above).toContain("ta.crossover(close, ema50)");

    const below = build({
      short: { entry: { type: "crossesBelow", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "ema50" } } },
    });
    expect(below).toContain("ta.crossunder(close, ema50)");
  });

  it("preserves boolean grouping with parentheses", () => {
    const script = build({
      long: {
        entry: {
          type: "or",
          children: [
            {
              type: "and",
              children: [
                { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "const", value: 1 } },
                { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "const", value: 5 } },
              ],
            },
            { type: "gt", left: { kind: "price", field: "high" }, right: { kind: "const", value: 9 } },
          ],
        },
      },
    });
    expect(script).toContain("((close > 1 and close < 5) or high > 9)");
  });

  it("translates negation", () => {
    const script = build({
      long: { entry: { type: "not", child: { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "const", value: 1 } } } },
    });
    expect(script).toContain("not (close > 1)");
  });

  it("refuses to emit a condition referencing an undeclared indicator", () => {
    expect(() =>
      strategyToPine(
        {
          name: "Broken",
          indicators: [],
          long: { entry: { type: "gt", left: { kind: "indicator", id: "ghost" }, right: { kind: "const", value: 1 } } },
          sizing: { mode: "fixedLot", lots: 1 },
        },
        options,
      ),
    ).toThrow(/referenced but never declared/);
  });
});

describe("risk and sizing translation", () => {
  it("sizes from equity so the stop costs the configured risk", () => {
    const script = strategyToPine(supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA), options);
    expect(script).toContain("(strategy.equity * 0.01) / riskDistance");
  });

  it("applies the stop to the actual fill price, not the signal close", () => {
    const script = strategyToPine(supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA), options);
    expect(script).toContain("strategy.position_avg_price - riskDistance");
    expect(script).toContain("strategy.position_avg_price + riskDistance");
  });

  it("derives a risk-reward target from the stop distance", () => {
    const script = strategyToPine(supertrendEmaStrategy({ ...DEFAULT_SUPERTREND_EMA, rewardRatio: 2 }), options);
    expect(script).toContain("targetDistance = stopDistance * 2");
  });

  it("converts pip distances into price using the instrument's pip size", () => {
    const strategy: Strategy = {
      name: "Pips",
      indicators: [],
      long: { entry: { type: "always" } },
      stopLoss: { mode: "pips", value: 20 },
      sizing: { mode: "fixedLot", lots: 1 },
    };
    // testInstrument has pipSize 1, so 20 pips is 20 price units.
    expect(strategyToPine(strategy, options)).toContain("stopDistance = 20");
  });

  it("emits a ratcheting trail that only tightens", () => {
    const strategy: Strategy = {
      name: "Trail",
      indicators: [],
      long: { entry: { type: "always" } },
      trailingStop: { mode: "pips", value: 10 },
      sizing: { mode: "fixedLot", lots: 1 },
    };
    const script = strategyToPine(strategy, options);
    expect(script).toContain("math.max(trailStop, candidate)");
    expect(script).toContain("math.min(trailStop, candidate)");
  });

  it("emits a session filter on the UTC hour", () => {
    const strategy: Strategy = {
      name: "Session",
      indicators: [],
      long: { entry: { type: "always" } },
      sessionUtc: { startHour: 7, endHour: 16 },
      sizing: { mode: "fixedLot", lots: 1 },
    };
    const script = strategyToPine(strategy, options);
    expect(script).toContain('hour(time, "UTC") >= 7');
    expect(script).toContain("differ by one bar");
  });

  it("wraps a session window that crosses midnight with 'or'", () => {
    const strategy: Strategy = {
      name: "Overnight",
      indicators: [],
      long: { entry: { type: "always" } },
      sessionUtc: { startHour: 22, endHour: 3 },
      sizing: { mode: "fixedLot", lots: 1 },
    };
    expect(strategyToPine(strategy, options)).toMatch(/>= 22 or hour\(time, "UTC"\) < 3/);
  });

  it("closes a position that overstays the time stop", () => {
    const strategy: Strategy = {
      name: "TimeStop",
      indicators: [],
      long: { entry: { type: "always" } },
      maxBarsInTrade: 20,
      sizing: { mode: "fixedLot", lots: 1 },
    };
    const script = strategyToPine(strategy, options);
    expect(script).toContain("barsInTrade >= 20");
    expect(script).toContain("strategy.close_all");
  });
});

describe("every preset exports", () => {
  for (const preset of [...PRESETS, supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA)]) {
    it(`translates "${preset.name}" without throwing`, () => {
      const script = strategyToPine(preset, options);
      expect(script).toContain("//@version=5");
      expect(script.length).toBeGreaterThan(200);
      // Nothing should leak an unresolved value into the emitted source.
      expect(script).not.toContain("undefined");
      expect(script).not.toContain("[object Object]");
    });
  }
});
