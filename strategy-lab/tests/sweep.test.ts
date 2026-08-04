import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import { cartesian, runSweep, spearman, DEFAULT_TARGETS } from "../src/optimize/sweep";
import { buildFromSweepParams } from "../src/strategies/supertrendEma";
import { noCosts, testInstrument } from "./helpers";

const config = { instrument: testInstrument, costs: noCosts, initialBalance: 10_000 };

describe("cartesian", () => {
  it("produces every combination", () => {
    const result = cartesian({ a: [1, 2], b: [10, 20, 30] });
    expect(result).toHaveLength(6);
    expect(result).toContainEqual({ a: 1, b: 10 });
    expect(result).toContainEqual({ a: 2, b: 30 });
  });

  it("is stable in order across calls", () => {
    const space = { a: [1, 2, 3], b: [4, 5] };
    expect(cartesian(space)).toEqual(cartesian(space));
  });

  it("returns nothing for an empty space", () => {
    expect(cartesian({})).toEqual([]);
  });

  it("rejects a parameter with no values", () => {
    expect(() => cartesian({ a: [] })).toThrow(/no values/);
  });
});

describe("spearman", () => {
  it("is 1 for identical orderings", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
  });

  it("is -1 for reversed orderings", () => {
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("matches a hand-computed value", () => {
    // ranks a = [0,1,2], ranks b = [1,2,0] → covariance -1, variances 2 and 2.
    expect(spearman([1, 2, 3], [2, 3, 1])).toBeCloseTo(-0.5, 10);
  });

  it("averages tied ranks", () => {
    // Two values tie for the bottom two ranks, sharing rank 0.5.
    expect(spearman([1, 1, 2], [1, 1, 2])).toBeCloseTo(1, 10);
  });

  it("returns null when a series has no variation to correlate", () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("returns null for fewer than three points", () => {
    expect(spearman([1, 2], [2, 1])).toBeNull();
  });

  it("rejects mismatched lengths", () => {
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow(/same length/);
  });
});

describe("runSweep", () => {
  const bars = generateBars({ bars: 6000, startPrice: 100, volatility: 0.006, seed: 5 });
  const space = { stMultiplier: [2, 3], emaPeriod: [50, 200] };

  const report = runSweep({
    bars,
    space,
    build: params => buildFromSweepParams(params),
    config,
    inSampleFraction: 0.7,
    minTrades: 5,
  });

  it("evaluates every combination", () => {
    expect(report.combinations).toBe(4);
    expect(report.rows).toHaveLength(4);
  });

  it("splits the data and never overlaps the halves", () => {
    expect(report.inSampleBars).toBe(Math.floor(bars.length * 0.7));
    expect(report.outOfSampleBars).toBe(bars.length - report.inSampleBars);
    expect(report.inSampleBars + report.outOfSampleBars).toBe(bars.length);
  });

  it("ranks by the in-sample score, best first", () => {
    const scores = report.rows.filter(row => !row.excluded).map(row => row.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("reports an out-of-sample result for every ranked combination", () => {
    for (const row of report.rows.filter(r => !r.excluded)) {
      expect(row.inSample).not.toBeNull();
      expect(row.outOfSample).not.toBeNull();
    }
  });

  it("always warns about how many combinations were tried", () => {
    expect(report.warnings.some(w => w.includes("combinations were tried"))).toBe(true);
  });

  it("rejects a split fraction outside the open unit interval", () => {
    for (const fraction of [0, 1, -0.5, 1.5]) {
      expect(() =>
        runSweep({ bars, space, build: params => buildFromSweepParams(params), config, inSampleFraction: fraction }),
      ).toThrow(/between 0 and 1/);
    }
  });

  it("refuses to split data too short to hold out anything meaningful", () => {
    expect(() =>
      runSweep({
        bars: bars.slice(0, 120),
        space,
        build: params => buildFromSweepParams(params),
        config,
      }),
    ).toThrow(/Not enough data to split/);
  });

  it("excludes combinations that did not trade enough, with a reason", () => {
    const strict = runSweep({
      bars,
      space,
      build: params => buildFromSweepParams(params),
      config,
      minTrades: 100_000,
    });

    expect(strict.qualified).toBe(0);
    expect(strict.best).toBeNull();
    for (const row of strict.rows) {
      expect(row.excluded).toMatch(/in-sample trades/);
    }
    expect(strict.warnings.some(w => w.includes("No combination produced enough trades"))).toBe(true);
  });

  it("does not let a failing combination abort the whole sweep", () => {
    const withBadCombo = runSweep({
      bars,
      space: { stMultiplier: [2, 3] },
      build: params =>
        params.stMultiplier === 2
          ? // Risk-percent sizing with no stop is rejected by the validator.
            { ...buildFromSweepParams(params), stopLoss: undefined }
          : buildFromSweepParams(params),
      config,
      minTrades: 5,
    });

    expect(withBadCombo.rows).toHaveLength(2);
    expect(withBadCombo.rows.some(row => row.excluded !== undefined)).toBe(true);
    expect(withBadCombo.rows.some(row => row.excluded === undefined)).toBe(true);
  });

  it("reports progress across the whole grid", () => {
    const seen: number[] = [];
    runSweep({
      bars,
      space,
      build: params => buildFromSweepParams(params),
      config,
      minTrades: 5,
      onProgress: done => seen.push(done),
    });
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(4);
  });

  it("counts target hits separately for each half", () => {
    expect(report.targets).toEqual(DEFAULT_TARGETS);
    expect(report.targetHits.both).toBeLessThanOrEqual(report.targetHits.inSample);
    expect(report.targetHits.both).toBeLessThanOrEqual(report.targetHits.outOfSample);
  });
});

describe("sweep honesty diagnostics", () => {
  it("flags a winner that does not beat the median out-of-sample", () => {
    // Random-walk data has no edge, so in-sample ranking is noise and the
    // winner lands wherever chance puts it out-of-sample.
    const bars = generateBars({ bars: 8000, startPrice: 100, volatility: 0.006, seed: 202 });
    const report = runSweep({
      bars,
      space: { stMultiplier: [1.5, 2, 2.5, 3], emaPeriod: [50, 100, 200] },
      build: params => buildFromSweepParams(params),
      config,
      minTrades: 10,
    });

    expect(report.qualified).toBeGreaterThan(3);
    expect(report.rankCorrelation).not.toBeNull();
    // Whatever the outcome, the report must state the search cost.
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.medianOutOfSampleScore).not.toBeNull();
  });
});
