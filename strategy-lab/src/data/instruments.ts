/**
 * Contract specs for common instruments.
 *
 * `quoteToAccountRate` assumes a USD account. Pairs whose quote currency is not
 * USD (EURGBP, for example) need the rate adjusting or the P&L will be wrong by
 * whatever that exchange rate is.
 */

import type { Instrument } from "../engine/types";

const forexDefaults = {
  contractSize: 100_000,
  minLot: 0.01,
  lotStep: 0.01,
  maxLot: 100,
  quoteToAccountRate: 1,
};

export const INSTRUMENTS: Record<string, Instrument> = {
  EURUSD: { symbol: "EURUSD", pipSize: 0.0001, digits: 5, ...forexDefaults },
  GBPUSD: { symbol: "GBPUSD", pipSize: 0.0001, digits: 5, ...forexDefaults },
  AUDUSD: { symbol: "AUDUSD", pipSize: 0.0001, digits: 5, ...forexDefaults },
  NZDUSD: { symbol: "NZDUSD", pipSize: 0.0001, digits: 5, ...forexDefaults },
  // JPY pairs quote to two decimals, so a pip is 0.01 rather than 0.0001.
  USDJPY: { symbol: "USDJPY", pipSize: 0.01, digits: 3, ...forexDefaults, quoteToAccountRate: 1 / 150 },
  XAUUSD: {
    symbol: "XAUUSD",
    pipSize: 0.01,
    digits: 2,
    contractSize: 100,
    minLot: 0.01,
    lotStep: 0.01,
    maxLot: 50,
    quoteToAccountRate: 1,
  },
  BTCUSD: {
    symbol: "BTCUSD",
    pipSize: 1,
    digits: 2,
    contractSize: 1,
    minLot: 0.001,
    lotStep: 0.001,
    maxLot: 100,
    quoteToAccountRate: 1,
  },
  ETHUSD: {
    symbol: "ETHUSD",
    pipSize: 0.1,
    digits: 2,
    contractSize: 1,
    minLot: 0.01,
    lotStep: 0.01,
    maxLot: 500,
    quoteToAccountRate: 1,
  },
};

/**
 * Looks up an instrument, falling back to a generic spec so an unknown symbol
 * does not block a backtest. The fallback is a guess — check `pipSize` and
 * `contractSize` before trusting P&L figures produced with it.
 */
export function getInstrument(symbol: string): Instrument {
  const known = INSTRUMENTS[symbol.toUpperCase()];
  if (known) return known;
  return {
    symbol: symbol.toUpperCase(),
    pipSize: 0.0001,
    digits: 5,
    ...forexDefaults,
  };
}
