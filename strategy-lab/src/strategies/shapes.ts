/**
 * The strategy shapes a sweep can search over.
 *
 * A "shape" is the structural idea — what triggers an entry, what filters it —
 * as opposed to the numbers inside it. The distinction matters because the
 * sweeps run so far have shown, repeatedly, that ranking parameters within a
 * shape is uninformative (rank correlations of 0.02, 0.08, -0.06 across gold
 * and EURUSD). When the numbers do not matter, the shape is what is left to
 * change, and switching between shapes should be one flag rather than an edit.
 */

import type { Strategy } from "../engine/strategy";
import type { ParamSet } from "../optimize/sweep";
import { buildFromSweepParams, DEFAULT_SWEEP_SPACE } from "./supertrendEma";
import { buildPullbackFromSweepParams, PULLBACK_SWEEP_SPACE } from "./supertrendPullback";

export interface ShapeFixedParams {
  rewardRatio: number;
  riskPercent: number;
}

export interface StrategyShape {
  id: string;
  label: string;
  /** One line on what this shape does differently. */
  premise: string;
  space: Record<string, number[]>;
  build: (params: ParamSet, fixed: ShapeFixedParams) => Strategy;
  /** Column headers for the sweep table, in the order params should be shown. */
  columns: { key: string; label: string; width: number }[];
}

export const SHAPES: Record<string, StrategyShape> = {
  flip: {
    id: "flip",
    label: "Supertrend flip + EMA filter",
    premise: "Enters on the bar Supertrend changes direction, if the EMA agrees.",
    space: DEFAULT_SWEEP_SPACE,
    build: (params, fixed) => buildFromSweepParams(params, fixed),
    columns: [
      { key: "stPeriod", label: "ST", width: 9 },
      { key: "emaPeriod", label: "EMA", width: 6 },
      { key: "stopAtrMultiple", label: "Stop", width: 6 },
    ],
  },

  pullback: {
    id: "pullback",
    label: "Supertrend direction + pullback entry",
    premise:
      "Uses Supertrend only for direction, then waits for a dip below a fast EMA and buys the recovery — " +
      "avoiding the flip bar, which arrives after most of the move.",
    space: PULLBACK_SWEEP_SPACE,
    build: (params, fixed) => buildPullbackFromSweepParams(params, fixed),
    columns: [
      { key: "stMultiplier", label: "ST×", width: 6 },
      { key: "pullbackEma", label: "Dip", width: 6 },
      { key: "emaPeriod", label: "EMA", width: 6 },
      { key: "stopAtrMultiple", label: "Stop", width: 6 },
    ],
  },
};

export function getShape(id: string): StrategyShape {
  const shape = SHAPES[id.toLowerCase()];
  if (!shape) {
    throw new Error(`Unknown shape "${id}". Available: ${Object.keys(SHAPES).join(", ")}`);
  }
  return shape;
}
