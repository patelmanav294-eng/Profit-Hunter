import type { Bar, CostModel, Instrument } from "../src/engine/types";

/**
 * A deliberately boring instrument: one unit per lot, one price unit per pip,
 * no currency conversion. P&L therefore equals the raw price difference times
 * lots, which keeps expected values in the tests hand-checkable.
 */
export const testInstrument: Instrument = {
  symbol: "TEST",
  pipSize: 1,
  digits: 2,
  contractSize: 1,
  minLot: 0.01,
  lotStep: 0.01,
  maxLot: 1000,
  quoteToAccountRate: 1,
};

export const noCosts: CostModel = {
  spreadPips: 0,
  commissionPerLotPerSide: 0,
  slippagePips: 0,
};

const HOUR = 3_600_000;
const START = Date.UTC(2024, 0, 1);

/** Builds bars from `[open, high, low, close]` tuples, spaced one hour apart. */
export function bars(rows: [number, number, number, number][], startTime = START): Bar[] {
  return rows.map(([open, high, low, close], i) => ({
    time: startTime + i * HOUR,
    open,
    high,
    low,
    close,
  }));
}

/** A flat bar — open, high, low and close all equal. Useful as filler. */
export function flat(price: number): [number, number, number, number] {
  return [price, price, price, price];
}
