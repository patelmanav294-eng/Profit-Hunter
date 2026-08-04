/**
 * Starter strategies.
 *
 * These are textbook setups, included so there is something to run on day one
 * and something to edit rather than a blank form. They are not edges — every
 * one of them is widely known and mostly arbitraged away. Treat them as
 * scaffolding for your own rules.
 */

import type { Strategy } from "../engine/strategy";

export const emaCrossover: Strategy = {
  name: "EMA 20/50 Crossover",
  description:
    "Classic trend following. Enters when the fast EMA crosses the slow one, stops out at 2 ATR and targets 2R. Trades both directions.",
  indicators: [
    { id: "fast", type: "ema", period: 20 },
    { id: "slow", type: "ema", period: 50 },
    { id: "atr14", type: "atr", period: 14 },
  ],
  long: {
    entry: { type: "crossesAbove", left: { kind: "indicator", id: "fast" }, right: { kind: "indicator", id: "slow" } },
  },
  short: {
    entry: { type: "crossesBelow", left: { kind: "indicator", id: "fast" }, right: { kind: "indicator", id: "slow" } },
  },
  stopLoss: { mode: "atr", multiple: 2, atrId: "atr14" },
  takeProfit: { mode: "riskReward", ratio: 2 },
  sizing: { mode: "riskPercent", percent: 1 },
};

export const rsiMeanReversion: Strategy = {
  name: "RSI Mean Reversion",
  description:
    "Fades extremes: buys oversold, sells overbought, and exits when RSI returns to the middle. Works in ranges, gets run over by trends.",
  indicators: [
    { id: "rsi14", type: "rsi", period: 14 },
    { id: "atr14", type: "atr", period: 14 },
  ],
  long: {
    entry: { type: "crossesAbove", left: { kind: "indicator", id: "rsi14" }, right: { kind: "const", value: 30 } },
    exit: { type: "gte", left: { kind: "indicator", id: "rsi14" }, right: { kind: "const", value: 55 } },
  },
  short: {
    entry: { type: "crossesBelow", left: { kind: "indicator", id: "rsi14" }, right: { kind: "const", value: 70 } },
    exit: { type: "lte", left: { kind: "indicator", id: "rsi14" }, right: { kind: "const", value: 45 } },
  },
  stopLoss: { mode: "atr", multiple: 2.5, atrId: "atr14" },
  sizing: { mode: "riskPercent", percent: 1 },
  maxBarsInTrade: 48,
};

export const donchianBreakout: Strategy = {
  name: "Donchian Breakout",
  description:
    "The Turtle setup: buy a 20-bar high, sell a 20-bar low, trail the stop at 3 ATR and let the trend decide when it ends.",
  indicators: [
    { id: "hh20", type: "highest", period: 20, source: "high" },
    { id: "ll20", type: "lowest", period: 20, source: "low" },
    { id: "atr20", type: "atr", period: 20 },
  ],
  long: {
    entry: { type: "gte", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "hh20" } },
  },
  short: {
    entry: { type: "lte", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "ll20" } },
  },
  stopLoss: { mode: "atr", multiple: 3, atrId: "atr20" },
  trailingStop: { mode: "atr", multiple: 3, atrId: "atr20" },
  sizing: { mode: "riskPercent", percent: 1 },
};

export const macdMomentum: Strategy = {
  name: "MACD Momentum with Trend Filter",
  description:
    "Only takes MACD signal-line crosses that agree with the 200 EMA, which cuts out most of the counter-trend whipsaw.",
  indicators: [
    { id: "macdLine", type: "macd", fast: 12, slow: 26, signal: 9, output: "macd" },
    { id: "macdSignal", type: "macd", fast: 12, slow: 26, signal: 9, output: "signal" },
    { id: "ema200", type: "ema", period: 200 },
    { id: "atr14", type: "atr", period: 14 },
  ],
  long: {
    entry: {
      type: "and",
      children: [
        {
          type: "crossesAbove",
          left: { kind: "indicator", id: "macdLine" },
          right: { kind: "indicator", id: "macdSignal" },
        },
        { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "ema200" } },
      ],
    },
  },
  short: {
    entry: {
      type: "and",
      children: [
        {
          type: "crossesBelow",
          left: { kind: "indicator", id: "macdLine" },
          right: { kind: "indicator", id: "macdSignal" },
        },
        { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "ema200" } },
      ],
    },
  },
  stopLoss: { mode: "atr", multiple: 2, atrId: "atr14" },
  takeProfit: { mode: "riskReward", ratio: 1.5 },
  sizing: { mode: "riskPercent", percent: 1 },
};

export const bollingerSqueeze: Strategy = {
  name: "Bollinger Band Reversion",
  description:
    "Buys a close below the lower band and sells a close above the upper one, exiting back at the middle band.",
  indicators: [
    { id: "bbUpper", type: "bbands", period: 20, stdDev: 2, output: "upper" },
    { id: "bbMiddle", type: "bbands", period: 20, stdDev: 2, output: "middle" },
    { id: "bbLower", type: "bbands", period: 20, stdDev: 2, output: "lower" },
    { id: "atr14", type: "atr", period: 14 },
  ],
  long: {
    entry: { type: "lt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "bbLower" } },
    exit: { type: "gte", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "bbMiddle" } },
  },
  short: {
    entry: { type: "gt", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "bbUpper" } },
    exit: { type: "lte", left: { kind: "price", field: "close" }, right: { kind: "indicator", id: "bbMiddle" } },
  },
  stopLoss: { mode: "atr", multiple: 2, atrId: "atr14" },
  sizing: { mode: "riskPercent", percent: 1 },
  maxBarsInTrade: 40,
};

export const PRESETS: Strategy[] = [
  emaCrossover,
  rsiMeanReversion,
  donchianBreakout,
  macdMomentum,
  bollingerSqueeze,
];
