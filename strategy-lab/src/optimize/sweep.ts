/**
 * Parameter sweep with an in-sample / out-of-sample split.
 *
 * A grid search over a few hundred combinations will always return something
 * that looks good. That is not a property of the strategy, it is a property of
 * searching: the best of N results is the maximum of N draws, and the maximum
 * of enough draws from pure noise is impressive. So the sweep never reports the
 * winner's in-sample number as if it meant something.
 *
 * The design that keeps it honest:
 *
 * 1. Ranking happens on the FIRST portion of the data only. The rest is held
 *    back and never influences which combination wins.
 * 2. The winner is then reported on the held-back portion. The gap between the
 *    two is the overfitting, measured rather than assumed.
 * 3. Every combination's out-of-sample result is kept, so the winner can be
 *    compared against the median. If picking the in-sample best lands you near
 *    the median out-of-sample, the search learned nothing.
 * 4. Spearman rank correlation between the two rankings is reported outright.
 *    Near zero means in-sample performance does not predict out-of-sample
 *    performance, which is the whole ballgame.
 */

import { runBacktest, type BacktestConfig } from "../engine/backtest";
import type { Metrics } from "../engine/metrics";
import type { Strategy } from "../engine/strategy";
import type { Bar } from "../engine/types";

export type ParamSet = Record<string, number>;

export interface SweepTargets {
  /** e.g. 0.6 for a 60% win rate. */
  minWinRate: number;
  minTrades: number;
  minProfitFactor: number;
}

export const DEFAULT_TARGETS: SweepTargets = {
  minWinRate: 0.6,
  minTrades: 30,
  minProfitFactor: 1.5,
};

export interface SweepOptions {
  bars: Bar[];
  space: Record<string, number[]>;
  build: (params: ParamSet) => Strategy;
  config: BacktestConfig;
  /** Fraction of bars used for ranking. The remainder is held back. Default 0.7. */
  inSampleFraction?: number;
  /** Combinations producing fewer trades than this are not ranked. Default 30. */
  minTrades?: number;
  /** What "best" means. Defaults to expectancy in R, which is what compounds. */
  objective?: (metrics: Metrics) => number;
  targets?: SweepTargets;
  onProgress?: (done: number, total: number) => void;
}

export interface SweepRow {
  params: ParamSet;
  inSample: Metrics | null;
  outOfSample: Metrics | null;
  score: number;
  /** Why this row was excluded from ranking, if it was. */
  excluded?: string;
  meetsTargetsInSample: boolean;
  meetsTargetsOutOfSample: boolean;
}

export interface SweepReport {
  /** Ranked by in-sample objective, best first. Excluded rows come last. */
  rows: SweepRow[];
  combinations: number;
  qualified: number;
  best: SweepRow | null;
  inSampleBars: number;
  outOfSampleBars: number;
  /**
   * Spearman rank correlation between in-sample and out-of-sample rankings,
   * over qualified rows. `null` when there are too few to be meaningful.
   */
  rankCorrelation: number | null;
  /** Median out-of-sample objective across qualified rows. */
  medianOutOfSampleScore: number | null;
  targets: SweepTargets;
  targetHits: { inSample: number; outOfSample: number; both: number };
  warnings: string[];
}

export function defaultObjective(metrics: Metrics): number {
  // Expectancy in R is the per-trade edge, which is what actually compounds.
  // Falling back to net profit percent keeps stop-less strategies rankable.
  return metrics.expectancyR ?? metrics.netProfitPercent / Math.max(metrics.totalTrades, 1);
}

export function runSweep(options: SweepOptions): SweepReport {
  const {
    bars,
    space,
    build,
    config,
    inSampleFraction = 0.7,
    minTrades = 30,
    objective = defaultObjective,
    targets = DEFAULT_TARGETS,
    onProgress,
  } = options;

  if (inSampleFraction <= 0 || inSampleFraction >= 1) {
    throw new Error(`inSampleFraction must be between 0 and 1 exclusive, got ${inSampleFraction}`);
  }

  const combinations = cartesian(space);
  if (combinations.length === 0) throw new Error("Parameter space is empty");

  const splitIndex = Math.floor(bars.length * inSampleFraction);
  const inSampleBars = bars.slice(0, splitIndex);
  const outOfSampleBars = bars.slice(splitIndex);

  if (inSampleBars.length < 100 || outOfSampleBars.length < 100) {
    throw new Error(
      `Not enough data to split: ${inSampleBars.length} in-sample and ${outOfSampleBars.length} out-of-sample bars. ` +
        "Load a longer history before sweeping.",
    );
  }

  const rows: SweepRow[] = combinations.map((params, index) => {
    onProgress?.(index, combinations.length);

    let inSample: Metrics | null = null;
    let outOfSample: Metrics | null = null;
    let excluded: string | undefined;

    try {
      const strategy = build(params);
      inSample = runBacktest(inSampleBars, strategy, config).metrics;
      // The out-of-sample run starts from a clean slate, re-warming its own
      // indicators. Carrying state across the split would leak the very
      // information the split exists to withhold.
      outOfSample = runBacktest(outOfSampleBars, strategy, config).metrics;
    } catch (error) {
      excluded = (error as Error).message;
    }

    if (!excluded && inSample && inSample.totalTrades < minTrades) {
      excluded = `only ${inSample.totalTrades} in-sample trades (need ${minTrades})`;
    }

    return {
      params,
      inSample,
      outOfSample,
      score: inSample && !excluded ? objective(inSample) : Number.NEGATIVE_INFINITY,
      excluded,
      meetsTargetsInSample: inSample ? meetsTargets(inSample, targets) : false,
      meetsTargetsOutOfSample: outOfSample ? meetsTargets(outOfSample, targets) : false,
    };
  });

  onProgress?.(combinations.length, combinations.length);

  rows.sort((a, b) => b.score - a.score);

  const qualified = rows.filter(row => !row.excluded && row.inSample && row.outOfSample);
  const best = qualified[0] ?? null;

  const outOfSampleScores = qualified.map(row => objective(row.outOfSample!)).sort((a, b) => a - b);
  const medianOutOfSampleScore =
    outOfSampleScores.length > 0 ? outOfSampleScores[Math.floor(outOfSampleScores.length / 2)] : null;

  const rankCorrelation = spearman(
    qualified.map(row => row.score),
    qualified.map(row => objective(row.outOfSample!)),
  );

  const targetHits = {
    inSample: rows.filter(row => row.meetsTargetsInSample).length,
    outOfSample: rows.filter(row => row.meetsTargetsOutOfSample).length,
    both: rows.filter(row => row.meetsTargetsInSample && row.meetsTargetsOutOfSample).length,
  };

  return {
    rows,
    combinations: combinations.length,
    qualified: qualified.length,
    best,
    inSampleBars: inSampleBars.length,
    outOfSampleBars: outOfSampleBars.length,
    rankCorrelation,
    medianOutOfSampleScore,
    targets,
    targetHits,
    warnings: buildWarnings({
      rows,
      qualified,
      best,
      combinations: combinations.length,
      rankCorrelation,
      medianOutOfSampleScore,
      objective,
      targets,
      targetHits,
    }),
  };
}

function meetsTargets(metrics: Metrics, targets: SweepTargets): boolean {
  return (
    metrics.totalTrades >= targets.minTrades &&
    metrics.winRate >= targets.minWinRate &&
    metrics.profitFactor >= targets.minProfitFactor
  );
}

interface WarningInput {
  rows: SweepRow[];
  qualified: SweepRow[];
  best: SweepRow | null;
  combinations: number;
  rankCorrelation: number | null;
  medianOutOfSampleScore: number | null;
  objective: (metrics: Metrics) => number;
  targets: SweepTargets;
  targetHits: { inSample: number; outOfSample: number; both: number };
}

/** The read-this-first list. Everything here is a reason to trust the winner less. */
function buildWarnings(input: WarningInput): string[] {
  const warnings: string[] = [];
  const { best, qualified, combinations, rankCorrelation, medianOutOfSampleScore, objective, targets, targetHits } =
    input;

  if (qualified.length === 0) {
    warnings.push("No combination produced enough trades to rank. Widen the grid or use a longer history.");
    return warnings;
  }

  warnings.push(
    `${combinations} combinations were tried. The best one's in-sample result is the maximum of ${combinations} ` +
      "draws, so it is inflated by the search itself — the out-of-sample column is the one to read.",
  );

  if (best?.inSample && best.outOfSample) {
    const inScore = best.score;
    const outScore = objective(best.outOfSample);
    if (outScore < inScore * 0.5) {
      warnings.push(
        `The winner's edge fell from ${inScore.toFixed(3)}R in-sample to ${outScore.toFixed(3)}R out-of-sample — ` +
          "more than half the apparent performance was fitted to the data it was chosen on.",
      );
    }
    if (outScore <= 0 && inScore > 0) {
      warnings.push("The winner is profitable in-sample and unprofitable out-of-sample. That is the definition of overfitting.");
    }
    if (medianOutOfSampleScore !== null && outScore <= medianOutOfSampleScore) {
      warnings.push(
        "Out-of-sample, the winner performs no better than the median combination — picking it added nothing over " +
          "choosing at random from the grid.",
      );
    }
  }

  if (rankCorrelation !== null && Math.abs(rankCorrelation) < 0.2) {
    warnings.push(
      `In-sample and out-of-sample rankings correlate at ${rankCorrelation.toFixed(2)}. Near zero means in-sample ` +
        "performance does not predict future performance, so the ranking is not informative.",
    );
  }

  if (targetHits.inSample > 0 && targetHits.both === 0) {
    warnings.push(
      `${targetHits.inSample} combinations hit the ${(targets.minWinRate * 100).toFixed(0)}% win-rate target ` +
        "in-sample, but none held it out-of-sample.",
    );
  }

  if (targetHits.both > 0) {
    warnings.push(
      `${targetHits.both} combinations hit the targets on both halves. That is worth a closer look, but it is still ` +
        "one split of one instrument — confirm on other symbols and timeframes before believing it.",
    );
  }

  return warnings;
}

/** Every combination of the parameter space, in a stable order. */
export function cartesian(space: Record<string, number[]>): ParamSet[] {
  const keys = Object.keys(space);
  if (keys.length === 0) return [];

  let combinations: ParamSet[] = [{}];
  for (const key of keys) {
    const values = space[key];
    if (values.length === 0) throw new Error(`Parameter "${key}" has no values to try`);
    const next: ParamSet[] = [];
    for (const combination of combinations) {
      for (const value of values) next.push({ ...combination, [key]: value });
    }
    combinations = next;
  }
  return combinations;
}

/**
 * Spearman rank correlation — Pearson correlation of the ranks.
 *
 * Ranks rather than raw values because the question is whether the ORDER
 * survives, not whether the magnitudes match. Ties share their average rank.
 */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length) throw new Error("Series must be the same length");
  if (a.length < 3) return null;

  const rankA = rank(a);
  const rankB = rank(b);
  const n = a.length;
  const meanRank = (n - 1) / 2;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const da = rankA[i] - meanRank;
    const db = rankB[i] - meanRank;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }

  if (varianceA === 0 || varianceB === 0) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

function rank(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((x, y) => x.value - y.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++;
    const averageRank = (i + j) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}
