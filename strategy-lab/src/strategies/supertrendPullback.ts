/**
 * Supertrend direction, pullback entry.
 *
 * Built to test one specific diagnosis. The flip-entry version
 * (`supertrendEma.ts`) won 22-30% of its out-of-sample trades on both gold and
 * EURUSD, against a 33.3% breakeven at 1:2 — worse than a coin flip. That is
 * not a tuning problem, it is a timing problem: Supertrend flips are lagging by
 * construction, so the flip bar arrives after much of the move has happened.
 * Entering there buys the extended end of a swing, and a 2R target then needs
 * the move to continue another two ATR — which is precisely what is least
 * likely once a swing is already stretched.
 *
 * So this version keeps Supertrend as the direction filter but stops using it
 * as the trigger. It waits for price to dip below a fast EMA and recover back
 * above it, entering on the recovery. Same trend, better price.
 *
 * Two consequences worth stating up front:
 *
 * - Entries are no longer tied to the flip bar; this buys dips throughout a
 *   trend rather than only after a reversal. Whether that means MORE trades
 *   depends entirely on `pullbackEma`, which is the frequency knob: a fast one
 *   (10) is crossed constantly and trades roughly 40% more often than the flip
 *   version, while a slow one (34) is selective and trades about a third less.
 *   It is not automatically the higher-sample choice.
 * - It gives up the reversal trade entirely. If a move runs without ever
 *   pulling back, this never gets in.
 */

import type { Strategy } from "../engine/strategy";

export interface SupertrendPullbackParams {
  /** ATR period inside Supertrend. */
  stPeriod: number;
  /** ATR multiplier for the Supertrend bands. */
  stMultiplier: number;
  /** Slow EMA acting as the overall trend filter. */
  emaPeriod: number;
  /** Fast EMA that price must dip below and recover above to trigger entry. */
  pullbackEma: number;
  /** Stop distance as a multiple of ATR. */
  stopAtrMultiple: number;
  /** Target as a multiple of the stop distance. */
  rewardRatio: number;
  /** Equity fraction risked per trade, in percent. */
  riskPercent: number;
}

export const DEFAULT_SUPERTREND_PULLBACK: SupertrendPullbackParams = {
  stPeriod: 10,
  stMultiplier: 3,
  emaPeriod: 200,
  pullbackEma: 20,
  stopAtrMultiple: 2,
  rewardRatio: 2,
  riskPercent: 1,
};

export function supertrendPullbackStrategy(params: SupertrendPullbackParams): Strategy {
  const { stPeriod, stMultiplier, emaPeriod, pullbackEma, stopAtrMultiple, rewardRatio, riskPercent } = params;

  const directionId = `st_direction_${stPeriod}_${stMultiplier}`;
  const trendId = `ema${emaPeriod}`;
  const pullbackId = `ema${pullbackEma}`;
  const atrId = `atr${stPeriod}`;

  return {
    name: `Supertrend ${stPeriod}/${stMultiplier} pullback to EMA ${pullbackEma}`,
    description:
      `Trades dips in the direction Supertrend reports, rather than entering on the flip. ` +
      `Needs price above the ${emaPeriod} EMA for longs, stops at ${stopAtrMultiple} ATR, targets ${rewardRatio}R.`,

    indicators: [
      { id: directionId, type: "supertrend", period: stPeriod, multiplier: stMultiplier, output: "direction" },
      { id: trendId, type: "ema", period: emaPeriod },
      { id: pullbackId, type: "ema", period: pullbackEma },
      { id: atrId, type: "atr", period: stPeriod },
    ],

    long: {
      entry: {
        type: "and",
        children: [
          // Direction as a STATE, not an event — the flip is no longer the trigger.
          { type: "gt", left: { kind: "indicator", id: directionId }, right: { kind: "const", value: 0 } },
          // The pullback and its resolution: price was below the fast EMA and
          // has just closed back above it.
          {
            type: "crossesAbove",
            left: { kind: "price", field: "close" },
            right: { kind: "indicator", id: pullbackId },
          },
          { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: trendId } },
        ],
      },
    },

    short: {
      entry: {
        type: "and",
        children: [
          { type: "lt", left: { kind: "indicator", id: directionId }, right: { kind: "const", value: 0 } },
          {
            type: "crossesBelow",
            left: { kind: "price", field: "close" },
            right: { kind: "indicator", id: pullbackId },
          },
          { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: trendId } },
        ],
      },
    },

    stopLoss: { mode: "atr", multiple: stopAtrMultiple, atrId },
    takeProfit: { mode: "riskReward", ratio: rewardRatio },
    sizing: { mode: "riskPercent", percent: riskPercent },
  };
}

/**
 * A deliberately smaller grid than the flip version's.
 *
 * The Supertrend period is pinned rather than varied: it only filters direction
 * here, and every extra axis multiplies the chances of a good-looking result.
 * 54 combinations, half the previous search.
 */
export const PULLBACK_SWEEP_SPACE: Record<string, number[]> = {
  stMultiplier: [2, 3],
  pullbackEma: [10, 20, 34],
  emaPeriod: [50, 100, 200],
  stopAtrMultiple: [1.5, 2, 2.5],
};

export function buildPullbackFromSweepParams(
  params: Record<string, number>,
  fixed: Partial<SupertrendPullbackParams> = {},
): Strategy {
  return supertrendPullbackStrategy({
    ...DEFAULT_SUPERTREND_PULLBACK,
    ...fixed,
    stPeriod: params.stPeriod ?? fixed.stPeriod ?? DEFAULT_SUPERTREND_PULLBACK.stPeriod,
    stMultiplier: params.stMultiplier ?? fixed.stMultiplier ?? DEFAULT_SUPERTREND_PULLBACK.stMultiplier,
    emaPeriod: params.emaPeriod ?? fixed.emaPeriod ?? DEFAULT_SUPERTREND_PULLBACK.emaPeriod,
    pullbackEma: params.pullbackEma ?? fixed.pullbackEma ?? DEFAULT_SUPERTREND_PULLBACK.pullbackEma,
    stopAtrMultiple:
      params.stopAtrMultiple ?? fixed.stopAtrMultiple ?? DEFAULT_SUPERTREND_PULLBACK.stopAtrMultiple,
    rewardRatio: params.rewardRatio ?? fixed.rewardRatio ?? DEFAULT_SUPERTREND_PULLBACK.rewardRatio,
    riskPercent: params.riskPercent ?? fixed.riskPercent ?? DEFAULT_SUPERTREND_PULLBACK.riskPercent,
  });
}
