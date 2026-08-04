import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import { runBacktest } from "../src/engine/backtest";
import { ema, supertrend } from "../src/engine/indicators";
import { validateStrategy } from "../src/engine/strategy";
import { strategyToPine } from "../src/export/pine";
import { getShape, SHAPES } from "../src/strategies/shapes";
import { DEFAULT_SUPERTREND_EMA, supertrendEmaStrategy } from "../src/strategies/supertrendEma";
import {
  DEFAULT_SUPERTREND_PULLBACK,
  PULLBACK_SWEEP_SPACE,
  supertrendPullbackStrategy,
} from "../src/strategies/supertrendPullback";
import { noCosts, testInstrument } from "./helpers";

const config = { instrument: testInstrument, costs: noCosts, initialBalance: 10_000 };
const data = generateBars({ bars: 8000, startPrice: 100, volatility: 0.005, seed: 61 });

describe("supertrend pullback strategy", () => {
  const strategy = supertrendPullbackStrategy(DEFAULT_SUPERTREND_PULLBACK);
  const result = runBacktest(data, strategy, config);

  it("is valid", () => {
    expect(validateStrategy(strategy)).toEqual([]);
  });

  it("trades", () => {
    expect(result.trades.length).toBeGreaterThan(20);
  });

  it("enters on a genuine pullback — price was below the fast EMA the bar before", () => {
    // This is the whole point of the shape. If the entry did not follow a dip,
    // it is just another trend-continuation trigger.
    const fast = ema(
      data.map(b => b.close),
      DEFAULT_SUPERTREND_PULLBACK.pullbackEma,
    );

    for (const trade of result.trades) {
      // Rules evaluate on the bar before the fill.
      const signal = trade.entryBarIndex - 1;
      const fastNow = fast[signal];
      const fastPrev = fast[signal - 1];
      expect(fastNow, `no EMA at signal bar ${signal}`).toBeDefined();
      expect(fastPrev).toBeDefined();

      if (trade.direction === "long") {
        expect(data[signal - 1].close, `long ${trade.id} did not follow a dip`).toBeLessThanOrEqual(fastPrev!);
        expect(data[signal].close).toBeGreaterThan(fastNow!);
      } else {
        expect(data[signal - 1].close, `short ${trade.id} did not follow a rally`).toBeGreaterThanOrEqual(
          fastPrev!,
        );
        expect(data[signal].close).toBeLessThan(fastNow!);
      }
    }
  });

  it("only trades in the direction Supertrend reports", () => {
    const { direction } = supertrend(
      data,
      DEFAULT_SUPERTREND_PULLBACK.stPeriod,
      DEFAULT_SUPERTREND_PULLBACK.stMultiplier,
    );

    for (const trade of result.trades) {
      const signal = trade.entryBarIndex - 1;
      expect(direction[signal], `trade ${trade.id} entered with no direction`).toBeDefined();
      expect(direction[signal], `trade ${trade.id} traded against Supertrend`).toBe(
        trade.direction === "long" ? 1 : -1,
      );
    }
  });

  it("respects the slow EMA trend filter", () => {
    const trend = ema(
      data.map(b => b.close),
      DEFAULT_SUPERTREND_PULLBACK.emaPeriod,
    );

    for (const trade of result.trades) {
      const signal = trade.entryBarIndex - 1;
      const filter = trend[signal]!;
      if (trade.direction === "long") {
        expect(data[signal].close).toBeGreaterThan(filter);
      } else {
        expect(data[signal].close).toBeLessThan(filter);
      }
    }
  });

  it("uses the pullback EMA as its frequency knob", () => {
    // A fast EMA is crossed constantly; a slow one is selective. This is the
    // parameter that decides how often the shape trades — not the Supertrend
    // settings, which only gate direction.
    const countWith = (pullbackEma: number) =>
      runBacktest(data, supertrendPullbackStrategy({ ...DEFAULT_SUPERTREND_PULLBACK, pullbackEma }), config)
        .trades.length;

    expect(countWith(10)).toBeGreaterThan(countWith(20));
    expect(countWith(20)).toBeGreaterThan(countWith(34));
  });

  it("trades more than the flip version only with a fast pullback EMA", () => {
    // Worth pinning down because the intuition "dips recur, flips do not" is
    // only half right: with a slow dip EMA this shape is the more selective of
    // the two, and gives up sample rather than gaining it.
    const flip = runBacktest(data, supertrendEmaStrategy(DEFAULT_SUPERTREND_EMA), config).trades.length;
    const fastDip = runBacktest(
      data,
      supertrendPullbackStrategy({ ...DEFAULT_SUPERTREND_PULLBACK, pullbackEma: 10 }),
      config,
    ).trades.length;
    const slowDip = runBacktest(
      data,
      supertrendPullbackStrategy({ ...DEFAULT_SUPERTREND_PULLBACK, pullbackEma: 34 }),
      config,
    ).trades.length;

    expect(fastDip).toBeGreaterThan(flip);
    expect(slowDip).toBeLessThan(flip);
  });

  it("exports to Pine without losing the pullback condition", () => {
    const script = strategyToPine(strategy, {
      instrument: testInstrument,
      costs: noCosts,
      initialCapital: 10_000,
    });
    expect(script).toMatch(/ta\.crossover\(close, ema20\)/);
    expect(script).toMatch(/_direction > 0/);
  });
});

describe("shape registry", () => {
  it("exposes both shapes with distinct grids", () => {
    expect(Object.keys(SHAPES).sort()).toEqual(["flip", "pullback"]);
    expect(SHAPES.flip.space).not.toEqual(SHAPES.pullback.space);
  });

  it("searches a smaller grid for the pullback shape", () => {
    // Fewer axes is fewer chances to find something that only looks good.
    const size = (space: Record<string, number[]>) =>
      Object.values(space).reduce((product, values) => product * values.length, 1);
    expect(size(PULLBACK_SWEEP_SPACE)).toBeLessThan(size(SHAPES.flip.space));
  });

  it("builds a valid strategy from every point in each grid", () => {
    for (const shape of Object.values(SHAPES)) {
      const keys = Object.keys(shape.space);
      // One corner of the grid is enough to catch a broken parameter mapping.
      const corner = Object.fromEntries(keys.map(key => [key, shape.space[key][0]]));
      const built = shape.build(corner, { rewardRatio: 2, riskPercent: 1 });
      expect(validateStrategy(built), `${shape.id} produced an invalid strategy`).toEqual([]);
    }
  });

  it("names every column it prints", () => {
    for (const shape of Object.values(SHAPES)) {
      for (const column of shape.columns) {
        expect(column.label.length, `${shape.id}/${column.key} label overflows its column`).toBeLessThanOrEqual(
          column.width,
        );
      }
    }
  });

  it("rejects an unknown shape by name, listing what exists", () => {
    expect(() => getShape("nonsense")).toThrow(/Unknown shape "nonsense"/);
    expect(() => getShape("nonsense")).toThrow(/flip, pullback/);
  });

  it("is case-insensitive", () => {
    expect(getShape("PULLBACK").id).toBe("pullback");
  });
});
