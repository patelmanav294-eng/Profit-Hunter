/**
 * Turns a declarative `Strategy` into things the engine can ask at each bar:
 * a table of computed indicator series, and a boolean evaluator for conditions.
 */

import * as ind from "./indicators";
import type { Condition, IndicatorSpec, Operand, Strategy } from "./strategy";
import type { Bar, Series } from "./types";

export type IndicatorTable = Record<string, Series>;

/** Computes every declared indicator once, up front. */
export function compileIndicators(bars: Bar[], specs: IndicatorSpec[]): IndicatorTable {
  const table: IndicatorTable = {};

  for (const spec of specs) {
    // Bar-shaped indicators (ATR, ADX, stochastic) read OHLC directly and ignore
    // this; the rest default to close unless the spec names another field.
    const source = ind.priceSeries(bars, "source" in spec ? (spec.source ?? "close") : "close");

    switch (spec.type) {
      case "sma":
        table[spec.id] = ind.sma(source, spec.period);
        break;
      case "ema":
        table[spec.id] = ind.ema(source, spec.period);
        break;
      case "rsi":
        table[spec.id] = ind.rsi(source, spec.period);
        break;
      case "atr":
        table[spec.id] = ind.atr(bars, spec.period);
        break;
      case "adx":
        table[spec.id] = ind.adx(bars, spec.period);
        break;
      case "plusDI":
        table[spec.id] = ind.directionalIndicators(bars, spec.period).plusDI;
        break;
      case "minusDI":
        table[spec.id] = ind.directionalIndicators(bars, spec.period).minusDI;
        break;
      case "macd": {
        const result = ind.macd(source, spec.fast, spec.slow, spec.signal);
        table[spec.id] = result[spec.output];
        break;
      }
      case "bbands": {
        const result = ind.bollinger(source, spec.period, spec.stdDev);
        table[spec.id] = result[spec.output];
        break;
      }
      case "stoch": {
        const result = ind.stochastic(bars, spec.kPeriod, spec.smooth, spec.dPeriod);
        table[spec.id] = result[spec.output];
        break;
      }
      case "supertrend": {
        const result = ind.supertrend(bars, spec.period, spec.multiplier);
        table[spec.id] = result[spec.output];
        break;
      }
      case "highest":
        table[spec.id] = ind.highest(source, spec.period);
        break;
      case "lowest":
        table[spec.id] = ind.lowest(source, spec.period);
        break;
      default: {
        // Exhaustiveness guard: adding a new IndicatorSpec variant without
        // handling it here becomes a compile error rather than a silent gap.
        const unreachable: never = spec;
        throw new Error(`Unhandled indicator spec: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  return table;
}

/** Resolves an operand at a given bar. `undefined` means "not available yet". */
function resolve(operand: Operand, bars: Bar[], table: IndicatorTable, index: number): number | undefined {
  switch (operand.kind) {
    case "const":
      return operand.value;
    case "price":
      return bars[index][operand.field];
    case "indicator":
      return table[operand.id]?.[index];
  }
}

/**
 * Evaluates a condition at bar `index`.
 *
 * An operand that has not warmed up yet makes the comparison `false` rather
 * than throwing — during the warm-up period the strategy simply does not trade.
 */
export function evaluateCondition(
  condition: Condition,
  bars: Bar[],
  table: IndicatorTable,
  index: number,
): boolean {
  switch (condition.type) {
    case "always":
      return true;

    case "and":
      return condition.children.every(child => evaluateCondition(child, bars, table, index));

    case "or":
      return condition.children.some(child => evaluateCondition(child, bars, table, index));

    case "not":
      return !evaluateCondition(condition.child, bars, table, index);

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = resolve(condition.left, bars, table, index);
      const right = resolve(condition.right, bars, table, index);
      if (left === undefined || right === undefined) return false;
      switch (condition.type) {
        case "gt":
          return left > right;
        case "gte":
          return left >= right;
        case "lt":
          return left < right;
        case "lte":
          return left <= right;
      }
    }

    case "crossesAbove":
    case "crossesBelow": {
      // A cross needs a previous bar to compare against.
      if (index === 0) return false;
      const leftNow = resolve(condition.left, bars, table, index);
      const rightNow = resolve(condition.right, bars, table, index);
      const leftPrev = resolve(condition.left, bars, table, index - 1);
      const rightPrev = resolve(condition.right, bars, table, index - 1);
      if (leftNow === undefined || rightNow === undefined || leftPrev === undefined || rightPrev === undefined) {
        return false;
      }
      return condition.type === "crossesAbove"
        ? leftPrev <= rightPrev && leftNow > rightNow
        : leftPrev >= rightPrev && leftNow < rightNow;
    }
  }
}

/**
 * The first bar index at which every indicator the strategy uses has a value.
 *
 * Reporting this matters: a backtest over 500 bars with a 200-period EMA only
 * had 300 bars of tradeable history, and the stats should be read in that light.
 */
export function warmupBars(strategy: Strategy, table: IndicatorTable, barCount: number): number {
  let warmup = 0;
  for (const spec of strategy.indicators) {
    const series = table[spec.id];
    if (!series) continue;
    let first = barCount;
    for (let i = 0; i < series.length; i++) {
      if (series[i] !== undefined) {
        first = i;
        break;
      }
    }
    if (first > warmup) warmup = first;
  }
  return warmup;
}
