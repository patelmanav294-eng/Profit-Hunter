/**
 * Parses rules written as text into the strategy DSL.
 *
 *   "ema 50 crosses above ema 200 and rsi 14 > 55"
 *   "close < bb lower and rsi < 30"
 *   "(adx > 25 and macd crosses above macd signal) or close > highest 20"
 *
 * This is a real grammar, not pattern matching against a list of phrases: a
 * recursive-descent parser over a tokenised input, with precedence (`or` binds
 * looser than `and`) and parentheses. Being deterministic means the same text
 * always yields the same rules, it runs offline, and every failure can point at
 * the exact token that broke.
 */

import type { Condition, IndicatorSpec, Operand } from "../engine/strategy";
import type { PriceField } from "../engine/types";

export interface ParsedRule {
  condition: Condition;
  /** Indicators the rule referenced, deduplicated, ready to merge into a strategy. */
  indicators: IndicatorSpec[];
}

export class RuleParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "RuleParseError";
  }
}

interface Token {
  type: "number" | "word" | "op" | "lparen" | "rparen";
  value: string;
  position: number;
}

const PRICE_FIELDS: Record<string, PriceField> = {
  close: "close",
  open: "open",
  high: "high",
  low: "low",
  price: "close",
};

export function parseRule(text: string): ParsedRule {
  const tokens = tokenize(text);
  if (tokens.length === 0) throw new RuleParseError("Nothing to parse", 0);

  const indicators = new Map<string, IndicatorSpec>();
  const parser = new Parser(tokens, indicators);
  const condition = parser.parseExpression();
  parser.expectEnd();

  return { condition, indicators: [...indicators.values()] };
}

/** Parses without throwing, for live validation as the user types. */
export function tryParseRule(text: string): { ok: true; rule: ParsedRule } | { ok: false; error: string; position: number } {
  try {
    return { ok: true, rule: parseRule(text) };
  } catch (error) {
    if (error instanceof RuleParseError) {
      return { ok: false, error: error.message, position: error.position };
    }
    throw error;
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: "(", position: i++ });
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", value: ")", position: i++ });
      continue;
    }

    if (char === ">" || char === "<" || char === "=" || char === "!") {
      const twoChar = text.slice(i, i + 2);
      if (twoChar === ">=" || twoChar === "<=" || twoChar === "==" || twoChar === "!=") {
        tokens.push({ type: "op", value: twoChar, position: i });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: char, position: i++ });
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const start = i;
      while (i < text.length && /[0-9.]/.test(text[i])) i++;
      tokens.push({ type: "number", value: text.slice(start, i), position: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      const start = i;
      while (i < text.length && /[a-zA-Z_]/.test(text[i])) i++;
      const word = text.slice(start, i).toLowerCase();

      // "ema50" is as common as "ema 50"; split the trailing digits back out so
      // both spellings reach the parser identically.
      if (i < text.length && /[0-9]/.test(text[i])) {
        const numberStart = i;
        while (i < text.length && /[0-9.]/.test(text[i])) i++;
        tokens.push({ type: "word", value: word, position: start });
        tokens.push({ type: "number", value: text.slice(numberStart, i), position: numberStart });
        continue;
      }

      tokens.push({ type: "word", value: word, position: start });
      continue;
    }

    // Commas and similar separators are noise between arguments.
    if (char === "," || char === ";") {
      i++;
      continue;
    }

    throw new RuleParseError(`Unexpected character "${char}"`, i);
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly indicators: Map<string, IndicatorSpec>,
  ) {}

  parseExpression(): Condition {
    return this.parseOr();
  }

  expectEnd(): void {
    if (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      throw new RuleParseError(`Unexpected "${token.value}" — expected the rule to end here`, token.position);
    }
  }

  private parseOr(): Condition {
    const children = [this.parseAnd()];
    while (this.peekWord("or")) {
      this.index++;
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): Condition {
    const children = [this.parseUnary()];
    // "and" and "&&" both read naturally; so does a bare "," between clauses.
    while (this.peekWord("and")) {
      this.index++;
      children.push(this.parseUnary());
    }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): Condition {
    if (this.peekWord("not")) {
      this.index++;
      return { type: "not", child: this.parseUnary() };
    }

    if (this.peek()?.type === "lparen") {
      this.index++;
      const inner = this.parseExpression();
      const closing = this.peek();
      if (closing?.type !== "rparen") {
        throw new RuleParseError("Missing closing parenthesis", closing?.position ?? this.endPosition());
      }
      this.index++;
      return inner;
    }

    return this.parseComparison();
  }

  private parseComparison(): Condition {
    const left = this.parseOperand();
    const comparator = this.parseComparator();
    const right = this.parseOperand();
    return { type: comparator, left, right };
  }

  private parseComparator(): "gt" | "gte" | "lt" | "lte" | "crossesAbove" | "crossesBelow" {
    const token = this.peek();
    if (!token) throw new RuleParseError("Expected a comparison such as > or 'crosses above'", this.endPosition());

    if (token.type === "op") {
      this.index++;
      switch (token.value) {
        case ">":
          return "gt";
        case ">=":
          return "gte";
        case "<":
          return "lt";
        case "<=":
          return "lte";
        default:
          throw new RuleParseError(
            `"${token.value}" is not a comparison this parser understands — use >, <, >=, <= or "crosses above"`,
            token.position,
          );
      }
    }

    if (token.type === "word") {
      // "crosses above" / "crossing below" / "crossover" and friends.
      if (["crosses", "cross", "crossing", "crossed"].includes(token.value)) {
        this.index++;
        const direction = this.peek();
        if (direction?.type === "word" && ["above", "over", "up"].includes(direction.value)) {
          this.index++;
          return "crossesAbove";
        }
        if (direction?.type === "word" && ["below", "under", "down"].includes(direction.value)) {
          this.index++;
          return "crossesBelow";
        }
        throw new RuleParseError(
          `"${token.value}" needs a direction — write "crosses above" or "crosses below"`,
          direction?.position ?? token.position,
        );
      }

      if (token.value === "crossesabove" || token.value === "crossover") {
        this.index++;
        return "crossesAbove";
      }
      if (token.value === "crossesbelow" || token.value === "crossunder") {
        this.index++;
        return "crossesBelow";
      }
      if (["above", "over", "exceeds"].includes(token.value)) {
        this.index++;
        return "gt";
      }
      if (["below", "under"].includes(token.value)) {
        this.index++;
        return "lt";
      }
    }

    throw new RuleParseError(
      `Expected a comparison after this, such as ">" or "crosses above", but found "${token.value}"`,
      token.position,
    );
  }

  private parseOperand(): Operand {
    const token = this.peek();
    if (!token) throw new RuleParseError("Expected a value or indicator", this.endPosition());

    if (token.type === "number") {
      this.index++;
      return { kind: "const", value: Number(token.value) };
    }

    if (token.type !== "word") {
      throw new RuleParseError(`Expected an indicator or number, found "${token.value}"`, token.position);
    }

    const priceField = PRICE_FIELDS[token.value];
    if (priceField) {
      this.index++;
      return { kind: "price", field: priceField };
    }

    return { kind: "indicator", id: this.parseIndicator() };
  }

  /** Reads an indicator reference, registers its spec, and returns its id. */
  private parseIndicator(): string {
    const token = this.tokens[this.index];
    const name = token.value;
    this.index++;

    switch (name) {
      case "sma":
      case "ma": {
        const period = this.requireNumber(`${name} needs a period, e.g. "sma 20"`, token.position);
        return this.register({ id: `sma${period}`, type: "sma", period });
      }
      case "ema": {
        const period = this.requireNumber('ema needs a period, e.g. "ema 50"', token.position);
        return this.register({ id: `ema${period}`, type: "ema", period });
      }
      case "rsi": {
        const period = this.optionalNumber() ?? 14;
        return this.register({ id: `rsi${period}`, type: "rsi", period });
      }
      case "atr": {
        const period = this.optionalNumber() ?? 14;
        return this.register({ id: `atr${period}`, type: "atr", period });
      }
      case "adx": {
        const period = this.optionalNumber() ?? 14;
        return this.register({ id: `adx${period}`, type: "adx", period });
      }
      case "macd":
        return this.parseMacd();
      case "bb":
      case "bband":
      case "bbands":
      case "bollinger":
        return this.parseBollinger(token.position);
      case "stoch":
      case "stochastic":
        return this.parseStochastic(token.position);
      case "highest":
      case "hh":
        return this.parseExtreme("highest", token.position);
      case "lowest":
      case "ll":
        return this.parseExtreme("lowest", token.position);
      default:
        throw new RuleParseError(
          `"${name}" is not an indicator this parser knows. Available: sma, ema, rsi, atr, adx, macd, bb, stoch, highest, lowest — plus close, open, high, low.`,
          token.position,
        );
    }
  }

  private parseMacd(): string {
    let output: "macd" | "signal" | "histogram" = "macd";
    const next = this.peek();
    if (next?.type === "word") {
      if (next.value === "signal") {
        output = "signal";
        this.index++;
      } else if (next.value === "hist" || next.value === "histogram") {
        output = "histogram";
        this.index++;
      } else if (next.value === "line") {
        this.index++;
      }
    }

    // Optional explicit periods: "macd 12 26 9".
    const fast = this.optionalNumber() ?? 12;
    const slow = this.optionalNumber() ?? 26;
    const signal = this.optionalNumber() ?? 9;

    return this.register({
      id: `macd_${output}_${fast}_${slow}_${signal}`,
      type: "macd",
      fast,
      slow,
      signal,
      output,
    });
  }

  private parseBollinger(position: number): string {
    const next = this.peek();
    let output: "upper" | "middle" | "lower" | null = null;
    if (next?.type === "word") {
      if (next.value === "upper" || next.value === "top") {
        output = "upper";
        this.index++;
      } else if (next.value === "lower" || next.value === "bottom") {
        output = "lower";
        this.index++;
      } else if (next.value === "middle" || next.value === "mid" || next.value === "basis") {
        output = "middle";
        this.index++;
      }
    }
    // A bare "bb" is ambiguous between three lines, so make the user say which.
    if (output === null) {
      throw new RuleParseError('Which band? Write "bb upper", "bb lower" or "bb middle"', position);
    }
    // Some people write "band" after the side: "bb upper band".
    if (this.peek()?.type === "word" && this.peek()!.value === "band") this.index++;

    const period = this.optionalNumber() ?? 20;
    const stdDev = this.optionalNumber() ?? 2;
    return this.register({ id: `bb_${output}_${period}_${stdDev}`, type: "bbands", period, stdDev, output });
  }

  private parseStochastic(position: number): string {
    const next = this.peek();
    let output: "k" | "d" | null = null;
    if (next?.type === "word" && (next.value === "k" || next.value === "d")) {
      output = next.value;
      this.index++;
    }
    if (output === null) {
      throw new RuleParseError('Which line? Write "stoch k" or "stoch d"', position);
    }

    const kPeriod = this.optionalNumber() ?? 14;
    const smooth = this.optionalNumber() ?? 3;
    const dPeriod = this.optionalNumber() ?? 3;
    return this.register({
      id: `stoch_${output}_${kPeriod}_${smooth}_${dPeriod}`,
      type: "stoch",
      kPeriod,
      smooth,
      dPeriod,
      output,
    });
  }

  private parseExtreme(type: "highest" | "lowest", position: number): string {
    const period = this.requireNumber(`${type} needs a lookback, e.g. "${type} 20"`, position);
    // Default to the matching extreme of the bar, which is what a breakout means.
    const source: PriceField = type === "highest" ? "high" : "low";
    const prefix = type === "highest" ? "hh" : "ll";
    return this.register({ id: `${prefix}${period}`, type, period, source });
  }

  private register(spec: IndicatorSpec): string {
    const existing = this.indicators.get(spec.id);
    // Ids encode every parameter, so a repeat id is the same indicator and the
    // duplicate can be dropped rather than recomputed.
    if (!existing) this.indicators.set(spec.id, spec);
    return spec.id;
  }

  private requireNumber(message: string, position: number): number {
    const value = this.optionalNumber();
    if (value === undefined) throw new RuleParseError(message, position);
    return value;
  }

  private optionalNumber(): number | undefined {
    const token = this.peek();
    if (token?.type !== "number") return undefined;
    this.index++;
    return Number(token.value);
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private peekWord(word: string): boolean {
    const token = this.peek();
    return token?.type === "word" && token.value === word;
  }

  private endPosition(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.position + last.value.length : 0;
  }
}

/**
 * Merges indicator specs from several parsed rules, keeping one entry per id.
 * Conflicting definitions cannot occur because ids encode every parameter.
 */
export function mergeIndicators(...groups: IndicatorSpec[][]): IndicatorSpec[] {
  const merged = new Map<string, IndicatorSpec>();
  for (const group of groups) {
    for (const spec of group) {
      if (!merged.has(spec.id)) merged.set(spec.id, spec);
    }
  }
  return [...merged.values()];
}

/** Renders a condition back to the text syntax, for round-tripping in the UI. */
export function conditionToText(condition: Condition, indicators: IndicatorSpec[]): string {
  const describe = (operand: Operand): string => {
    switch (operand.kind) {
      case "const":
        return String(operand.value);
      case "price":
        return operand.field;
      case "indicator":
        return describeIndicator(indicators.find(i => i.id === operand.id), operand.id);
    }
  };

  switch (condition.type) {
    case "always":
      return "always";
    case "and":
      return condition.children.map(c => wrap(c, indicators)).join(" and ");
    case "or":
      return condition.children.map(c => wrap(c, indicators)).join(" or ");
    case "not":
      return `not ${wrap(condition.child, indicators)}`;
    case "gt":
      return `${describe(condition.left)} > ${describe(condition.right)}`;
    case "gte":
      return `${describe(condition.left)} >= ${describe(condition.right)}`;
    case "lt":
      return `${describe(condition.left)} < ${describe(condition.right)}`;
    case "lte":
      return `${describe(condition.left)} <= ${describe(condition.right)}`;
    case "crossesAbove":
      return `${describe(condition.left)} crosses above ${describe(condition.right)}`;
    case "crossesBelow":
      return `${describe(condition.left)} crosses below ${describe(condition.right)}`;
  }
}

function wrap(condition: Condition, indicators: IndicatorSpec[]): string {
  const text = conditionToText(condition, indicators);
  // Parenthesise nested boolean groups so precedence survives a round trip.
  return condition.type === "and" || condition.type === "or" ? `(${text})` : text;
}

function describeIndicator(spec: IndicatorSpec | undefined, fallbackId: string): string {
  if (!spec) return fallbackId;
  switch (spec.type) {
    case "sma":
    case "ema":
    case "rsi":
    case "atr":
    case "adx":
      return `${spec.type} ${spec.period}`;
    case "macd":
      return spec.output === "macd" ? "macd" : `macd ${spec.output}`;
    case "bbands":
      return `bb ${spec.output} ${spec.period} ${spec.stdDev}`;
    case "stoch":
      return `stoch ${spec.output} ${spec.kPeriod} ${spec.smooth} ${spec.dPeriod}`;
    case "highest":
      return `highest ${spec.period}`;
    case "lowest":
      return `lowest ${spec.period}`;
    case "plusDI":
      return `plusDI ${spec.period}`;
    case "minusDI":
      return `minusDI ${spec.period}`;
  }
}
