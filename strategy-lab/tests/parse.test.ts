import { describe, expect, it } from "vitest";

import { generateBars } from "../src/data/synthetic";
import { runBacktest } from "../src/engine/backtest";
import { validateStrategy, type Strategy } from "../src/engine/strategy";
import { conditionToText, mergeIndicators, parseRule, tryParseRule } from "../src/strategies/parse";
import { noCosts, testInstrument } from "./helpers";

describe("operands", () => {
  it("reads a price field against a constant", () => {
    const { condition, indicators } = parseRule("close > 100");
    expect(condition).toEqual({
      type: "gt",
      left: { kind: "price", field: "close" },
      right: { kind: "const", value: 100 },
    });
    expect(indicators).toEqual([]);
  });

  it("treats bare 'price' as the close", () => {
    const { condition } = parseRule("price < 50");
    expect(condition).toMatchObject({ left: { kind: "price", field: "close" } });
  });

  it("accepts an indicator period with or without a space", () => {
    const spaced = parseRule("ema 50 > close");
    const joined = parseRule("ema50 > close");
    expect(joined.condition).toEqual(spaced.condition);
    expect(joined.indicators).toEqual(spaced.indicators);
  });

  it("accepts decimals", () => {
    const { condition } = parseRule("close > 1.2345");
    expect(condition).toMatchObject({ right: { kind: "const", value: 1.2345 } });
  });
});

describe("indicators", () => {
  it("registers each referenced indicator once", () => {
    const { indicators } = parseRule("ema 50 crosses above ema 200 and ema 50 > close");
    expect(indicators).toHaveLength(2);
    expect(indicators.map(i => i.id).sort()).toEqual(["ema200", "ema50"]);
  });

  it("defaults conventional periods but honours explicit ones", () => {
    expect(parseRule("rsi > 50").indicators[0]).toEqual({ id: "rsi14", type: "rsi", period: 14 });
    expect(parseRule("rsi 21 > 50").indicators[0]).toEqual({ id: "rsi21", type: "rsi", period: 21 });
    expect(parseRule("adx > 25").indicators[0]).toMatchObject({ type: "adx", period: 14 });
  });

  it("parses the three MACD outputs", () => {
    expect(parseRule("macd > 0").indicators[0]).toMatchObject({ type: "macd", output: "macd" });
    expect(parseRule("macd signal > 0").indicators[0]).toMatchObject({ output: "signal" });
    expect(parseRule("macd histogram > 0").indicators[0]).toMatchObject({ output: "histogram" });
    expect(parseRule("macd hist > 0").indicators[0]).toMatchObject({ output: "histogram" });
  });

  it("accepts explicit MACD periods", () => {
    expect(parseRule("macd line 5 34 5 > 0").indicators[0]).toMatchObject({
      type: "macd",
      fast: 5,
      slow: 34,
      signal: 5,
    });
  });

  it("parses Bollinger bands, with and without the word 'band'", () => {
    expect(parseRule("close < bb lower").indicators[0]).toMatchObject({
      type: "bbands",
      output: "lower",
      period: 20,
      stdDev: 2,
    });
    expect(parseRule("close > bb upper band 30 2.5").indicators[0]).toMatchObject({
      output: "upper",
      period: 30,
      stdDev: 2.5,
    });
  });

  it("parses stochastic lines", () => {
    expect(parseRule("stoch k crosses above stoch d").indicators).toHaveLength(2);
    expect(parseRule("stoch k > 80").indicators[0]).toMatchObject({ output: "k", kPeriod: 14 });
  });

  it("reads Donchian extremes from the matching side of the bar", () => {
    expect(parseRule("close >= highest 20").indicators[0]).toEqual({
      id: "hh20",
      type: "highest",
      period: 20,
      source: "high",
    });
    expect(parseRule("close <= lowest 20").indicators[0]).toMatchObject({ source: "low" });
  });

  it("accepts hh/ll shorthand", () => {
    expect(parseRule("close >= hh 55").indicators[0]).toMatchObject({ type: "highest", period: 55 });
  });
});

describe("comparators", () => {
  it("handles every symbolic comparison", () => {
    expect(parseRule("close > 1").condition.type).toBe("gt");
    expect(parseRule("close >= 1").condition.type).toBe("gte");
    expect(parseRule("close < 1").condition.type).toBe("lt");
    expect(parseRule("close <= 1").condition.type).toBe("lte");
  });

  it("handles the ways people write a crossover", () => {
    for (const phrase of ["crosses above", "cross above", "crossing over", "crossed up"]) {
      expect(parseRule(`ema 20 ${phrase} ema 50`).condition.type, phrase).toBe("crossesAbove");
    }
    for (const phrase of ["crosses below", "cross under", "crossing down"]) {
      expect(parseRule(`ema 20 ${phrase} ema 50`).condition.type, phrase).toBe("crossesBelow");
    }
  });

  it("treats a bare 'above'/'below' as a plain comparison, not a cross", () => {
    expect(parseRule("close above ema 50").condition.type).toBe("gt");
    expect(parseRule("close below ema 50").condition.type).toBe("lt");
  });
});

describe("boolean structure", () => {
  it("binds 'and' tighter than 'or'", () => {
    // a and b or c  ⇒  (a and b) or c
    const { condition } = parseRule("close > 1 and close > 2 or close > 3");
    expect(condition.type).toBe("or");
    if (condition.type !== "or") throw new Error("unreachable");
    expect(condition.children[0].type).toBe("and");
    expect(condition.children[1].type).toBe("gt");
  });

  it("lets parentheses override precedence", () => {
    const { condition } = parseRule("close > 1 and (close > 2 or close > 3)");
    expect(condition.type).toBe("and");
    if (condition.type !== "and") throw new Error("unreachable");
    expect(condition.children[1].type).toBe("or");
  });

  it("flattens a chain of 'and' into one node", () => {
    const { condition } = parseRule("close > 1 and close > 2 and close > 3");
    expect(condition.type).toBe("and");
    if (condition.type !== "and") throw new Error("unreachable");
    expect(condition.children).toHaveLength(3);
  });

  it("supports negation", () => {
    const { condition } = parseRule("not close > 1");
    expect(condition.type).toBe("not");
  });
});

describe("error reporting", () => {
  it("names an unknown indicator and lists what is available", () => {
    const result = tryParseRule("ichimoku > 5");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/ichimoku/);
    expect(result.error).toMatch(/sma, ema, rsi/);
    // The list the user is pointed at must stay in step with what parses.
    expect(result.error).toMatch(/supertrend/);
  });

  it("asks which Bollinger band was meant", () => {
    const result = tryParseRule("close < bb");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/Which band/);
  });

  it("asks which stochastic line was meant", () => {
    const result = tryParseRule("stoch > 80");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/Which line/);
  });

  it("requires a period where there is no sensible default", () => {
    const result = tryParseRule("ema > close");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/ema needs a period/);
  });

  it("rejects a crossover with no direction", () => {
    const result = tryParseRule("ema 20 crosses ema 50");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/crosses above/);
  });

  it("reports an unclosed parenthesis", () => {
    const result = tryParseRule("(close > 1 and close > 2");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/closing parenthesis/);
  });

  it("points at trailing junk rather than silently ignoring it", () => {
    const result = tryParseRule("close > 1 close");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/expected the rule to end/);
  });

  it("gives a character position for the failure", () => {
    const result = tryParseRule("close > ema");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.position).toBeGreaterThan(0);
  });

  it("rejects empty input", () => {
    const result = tryParseRule("   ");
    expect(result.ok).toBe(false);
  });
});

describe("round trip", () => {
  const samples = [
    "close > 100",
    "ema 20 crosses above ema 50",
    "rsi 14 < 30 and close > ema 200",
    "close < bb lower 20 2 or rsi 14 < 25",
    "stoch k crosses below stoch d and adx 14 > 25",
  ];

  for (const text of samples) {
    it(`re-parses its own rendering of "${text}"`, () => {
      const first = parseRule(text);
      const rendered = conditionToText(first.condition, first.indicators);
      const second = parseRule(rendered);
      expect(second.condition).toEqual(first.condition);
    });
  }
});

describe("mergeIndicators", () => {
  it("keeps one entry per id across rules", () => {
    const long = parseRule("ema 50 crosses above ema 200");
    const short = parseRule("ema 50 crosses below ema 200");
    expect(mergeIndicators(long.indicators, short.indicators)).toHaveLength(2);
  });
});

describe("parsed rules drive a real backtest", () => {
  it("builds a strategy that validates and runs", () => {
    const long = parseRule("ema 20 crosses above ema 50 and rsi 14 > 50");
    const short = parseRule("ema 20 crosses below ema 50 and rsi 14 < 50");

    const strategy: Strategy = {
      name: "Parsed",
      indicators: mergeIndicators(long.indicators, short.indicators, [
        { id: "atr14", type: "atr", period: 14 },
      ]),
      long: { entry: long.condition },
      short: { entry: short.condition },
      stopLoss: { mode: "atr", multiple: 2, atrId: "atr14" },
      takeProfit: { mode: "riskReward", ratio: 2 },
      sizing: { mode: "riskPercent", percent: 1 },
    };

    expect(validateStrategy(strategy)).toEqual([]);

    const data = generateBars({ bars: 2000, startPrice: 100, volatility: 0.005, seed: 31 });
    const result = runBacktest(data, strategy, {
      instrument: testInstrument,
      costs: noCosts,
      initialBalance: 10_000,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics.netProfit)).toBe(true);
  });
});
