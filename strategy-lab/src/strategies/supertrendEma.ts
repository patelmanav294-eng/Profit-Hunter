/**
 * Supertrend + EMA trend filter.
 *
 * Supertrend supplies the timing — the entry fires on the bar its direction
 * flips, not while it merely sits in a direction, so the rule is an event
 * rather than a state that would re-trigger on every bar. The EMA supplies the
 * context: flips against the longer trend are ignored, which is what removes
 * most of the whipsaw Supertrend produces on its own in a range.
 *
 * The stop is an ATR multiple rather than the Supertrend line itself. They
 * amount to nearly the same distance — the Supertrend line IS an ATR band — but
 * an explicit multiple is a parameter the sweep can vary independently of the
 * indicator that generates signals, which keeps the two effects separable.
 */

import type { Strategy } from "../engine/strategy";

export interface SupertrendEmaParams {
  /** ATR period inside Supertrend. */
  stPeriod: number;
  /** ATR multiplier for the Supertrend bands. */
  stMultiplier: number;
  /** EMA period used as the trend filter. */
  emaPeriod: number;
  /** Stop distance as a multiple of ATR. */
  stopAtrMultiple: number;
  /** Target as a multiple of the stop distance. 2 gives a 1:2 risk-reward. */
  rewardRatio: number;
  /** Equity fraction risked per trade, in percent. */
  riskPercent: number;
  /** ATR period used for the stop. Defaults to the Supertrend period. */
  stopAtrPeriod?: number;
}

export const DEFAULT_SUPERTREND_EMA: SupertrendEmaParams = {
  stPeriod: 10,
  stMultiplier: 3,
  emaPeriod: 200,
  stopAtrMultiple: 2,
  rewardRatio: 2,
  riskPercent: 1,
};

export function supertrendEmaStrategy(params: SupertrendEmaParams): Strategy {
  const { stPeriod, stMultiplier, emaPeriod, stopAtrMultiple, rewardRatio, riskPercent } = params;
  const atrPeriod = params.stopAtrPeriod ?? stPeriod;

  const directionId = `st_direction_${stPeriod}_${stMultiplier}`;
  const emaId = `ema${emaPeriod}`;
  const atrId = `atr${atrPeriod}`;

  return {
    name: `Supertrend ${stPeriod}/${stMultiplier} + EMA ${emaPeriod}`,
    description:
      `Enters on a Supertrend flip that agrees with the ${emaPeriod} EMA. ` +
      `Stop at ${stopAtrMultiple} ATR, target at ${rewardRatio}R, risking ${riskPercent}% per trade.`,

    indicators: [
      { id: directionId, type: "supertrend", period: stPeriod, multiplier: stMultiplier, output: "direction" },
      { id: emaId, type: "ema", period: emaPeriod },
      { id: atrId, type: "atr", period: atrPeriod },
    ],

    long: {
      entry: {
        type: "and",
        children: [
          // Direction runs -1 → +1, so a cross of zero is exactly the flip bar.
          {
            type: "crossesAbove",
            left: { kind: "indicator", id: directionId },
            right: { kind: "const", value: 0 },
          },
          { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: emaId } },
        ],
      },
    },

    short: {
      entry: {
        type: "and",
        children: [
          {
            type: "crossesBelow",
            left: { kind: "indicator", id: directionId },
            right: { kind: "const", value: 0 },
          },
          { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: emaId } },
        ],
      },
    },

    stopLoss: { mode: "atr", multiple: stopAtrMultiple, atrId },
    takeProfit: { mode: "riskReward", ratio: rewardRatio },
    sizing: { mode: "riskPercent", percent: riskPercent },
  };
}

/**
 * The grid the sweep explores by default.
 *
 * Deliberately modest — 108 combinations. Every extra axis multiplies the
 * number of chances to find something that looks good by luck, and the
 * in-sample winner's edge is inflated by roughly the spread of the whole grid.
 * A wider net does not find a better strategy, it finds a better-looking one.
 */
export const DEFAULT_SWEEP_SPACE: Record<string, number[]> = {
  stPeriod: [7, 10, 14],
  stMultiplier: [2, 2.5, 3, 3.5],
  emaPeriod: [50, 100, 200],
  stopAtrMultiple: [1.5, 2, 2.5],
};

/** Builds a strategy from a sweep parameter set, filling in anything not varied. */
export function buildFromSweepParams(
  params: Record<string, number>,
  fixed: Partial<SupertrendEmaParams> = {},
): Strategy {
  return supertrendEmaStrategy({
    ...DEFAULT_SUPERTREND_EMA,
    ...fixed,
    stPeriod: params.stPeriod ?? fixed.stPeriod ?? DEFAULT_SUPERTREND_EMA.stPeriod,
    stMultiplier: params.stMultiplier ?? fixed.stMultiplier ?? DEFAULT_SUPERTREND_EMA.stMultiplier,
    emaPeriod: params.emaPeriod ?? fixed.emaPeriod ?? DEFAULT_SUPERTREND_EMA.emaPeriod,
    stopAtrMultiple: params.stopAtrMultiple ?? fixed.stopAtrMultiple ?? DEFAULT_SUPERTREND_EMA.stopAtrMultiple,
    rewardRatio: params.rewardRatio ?? fixed.rewardRatio ?? DEFAULT_SUPERTREND_EMA.rewardRatio,
    riskPercent: params.riskPercent ?? fixed.riskPercent ?? DEFAULT_SUPERTREND_EMA.riskPercent,
  });
}
