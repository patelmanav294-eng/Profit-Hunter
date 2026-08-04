/**
 * Turns the UI's flat form model into a `Strategy`.
 *
 * Kept out of the React tree so the whole form-to-strategy path is testable
 * without rendering anything.
 */

import type { Condition, IndicatorSpec, SizingSpec, StopSpec, Strategy, TargetSpec } from "../engine/strategy";
import { validateStrategy } from "../engine/strategy";
import { conditionToText, mergeIndicators, tryParseRule } from "./parse";

export type StopMode = "none" | "pips" | "percent" | "atr";
export type TargetMode = StopMode | "riskReward";

export interface StrategyForm {
  name: string;
  longEntry: string;
  longExit: string;
  shortEntry: string;
  shortExit: string;

  stopMode: StopMode;
  stopValue: number;
  targetMode: TargetMode;
  targetValue: number;
  trailMode: StopMode;
  trailValue: number;
  /** Period for the ATR that atr-based stops and targets measure against. */
  atrPeriod: number;

  sizingMode: SizingSpec["mode"];
  sizingValue: number;

  maxBarsInTrade: number | null;
  cooldownBars: number | null;
  sessionEnabled: boolean;
  sessionStart: number;
  sessionEnd: number;
}

export const DEFAULT_FORM: StrategyForm = {
  name: "My Strategy",
  longEntry: "ema 20 crosses above ema 50",
  longExit: "",
  shortEntry: "ema 20 crosses below ema 50",
  shortExit: "",

  stopMode: "atr",
  stopValue: 2,
  targetMode: "riskReward",
  targetValue: 2,
  trailMode: "none",
  trailValue: 2,
  atrPeriod: 14,

  sizingMode: "riskPercent",
  sizingValue: 1,

  maxBarsInTrade: null,
  cooldownBars: null,
  sessionEnabled: false,
  sessionStart: 7,
  sessionEnd: 16,
};

export interface BuildIssue {
  /** Which form field the problem belongs to, for inline display. */
  field: string;
  message: string;
  /** Character offset within the field's text, when the parser reported one. */
  position?: number;
}

export type BuildResult =
  | { ok: true; strategy: Strategy }
  | { ok: false; issues: BuildIssue[] };

export function buildStrategy(form: StrategyForm): BuildResult {
  const issues: BuildIssue[] = [];
  const indicatorGroups: IndicatorSpec[][] = [];

  const parseField = (field: keyof StrategyForm & string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;

    const parsed = tryParseRule(trimmed);
    if (!parsed.ok) {
      issues.push({ field, message: parsed.error, position: parsed.position });
      return undefined;
    }
    indicatorGroups.push(parsed.rule.indicators);
    return parsed.rule.condition;
  };

  const longEntry = parseField("longEntry", form.longEntry);
  const longExit = parseField("longExit", form.longExit);
  const shortEntry = parseField("shortEntry", form.shortEntry);
  const shortExit = parseField("shortExit", form.shortExit);

  if (!longEntry && !shortEntry) {
    issues.push({
      field: "longEntry",
      message: "Give the strategy at least one entry rule — long, short, or both",
    });
  }

  // An ATR indicator is only worth computing if something actually measures
  // against it.
  const atrId = `atr${form.atrPeriod}`;
  const needsAtr = form.stopMode === "atr" || form.targetMode === "atr" || form.trailMode === "atr";
  if (needsAtr) {
    indicatorGroups.push([{ id: atrId, type: "atr", period: form.atrPeriod }]);
  }

  const stopLoss = toStopSpec(form.stopMode, form.stopValue, atrId);
  const trailingStop = toStopSpec(form.trailMode, form.trailValue, atrId);
  const takeProfit: TargetSpec | undefined =
    form.targetMode === "riskReward"
      ? { mode: "riskReward", ratio: form.targetValue }
      : toStopSpec(form.targetMode, form.targetValue, atrId);

  if (issues.length > 0) return { ok: false, issues };

  const strategy: Strategy = {
    name: form.name.trim() || "Untitled Strategy",
    indicators: mergeIndicators(...indicatorGroups),
    sizing:
      form.sizingMode === "fixedLot"
        ? { mode: "fixedLot", lots: form.sizingValue }
        : { mode: "riskPercent", percent: form.sizingValue },
  };

  if (longEntry) strategy.long = longExit ? { entry: longEntry, exit: longExit } : { entry: longEntry };
  if (shortEntry) strategy.short = shortExit ? { entry: shortEntry, exit: shortExit } : { entry: shortEntry };
  if (stopLoss) strategy.stopLoss = stopLoss;
  if (takeProfit) strategy.takeProfit = takeProfit;
  if (trailingStop) strategy.trailingStop = trailingStop;
  if (form.maxBarsInTrade !== null) strategy.maxBarsInTrade = form.maxBarsInTrade;
  if (form.cooldownBars !== null) strategy.cooldownBars = form.cooldownBars;
  if (form.sessionEnabled) {
    strategy.sessionUtc = { startHour: form.sessionStart, endHour: form.sessionEnd };
  }

  // The engine's own validator catches the cross-field problems the form cannot,
  // such as risk-percent sizing without a stop to measure risk against.
  const validationIssues = validateStrategy(strategy);
  if (validationIssues.length > 0) {
    return {
      ok: false,
      issues: validationIssues.map(issue => ({ field: fieldForPath(issue.path), message: issue.message })),
    };
  }

  return { ok: true, strategy };
}

function toStopSpec(mode: StopMode, value: number, atrId: string): StopSpec | undefined {
  switch (mode) {
    case "none":
      return undefined;
    case "pips":
      return { mode: "pips", value };
    case "percent":
      return { mode: "percent", value };
    case "atr":
      return { mode: "atr", multiple: value, atrId };
  }
}

/**
 * The inverse of `buildStrategy`: renders a `Strategy` back into form fields so
 * a preset can be loaded and then edited.
 *
 * Round-tripping is lossy in one specific way — the ATR period shown comes from
 * whichever ATR the stop references, so a strategy using two different ATR
 * periods for stop and target collapses to one. Presets do not do that, and the
 * form has no way to express it either.
 */
export function formFromStrategy(strategy: Strategy): StrategyForm {
  const indicators = strategy.indicators;
  const render = (condition: Condition | undefined): string =>
    condition ? conditionToText(condition, indicators) : "";

  const atrPeriod = findAtrPeriod(strategy) ?? DEFAULT_FORM.atrPeriod;
  const stop = fromStopSpec(strategy.stopLoss);
  const trail = fromStopSpec(strategy.trailingStop);
  const target: { mode: TargetMode; value: number } =
    strategy.takeProfit?.mode === "riskReward"
      ? { mode: "riskReward", value: strategy.takeProfit.ratio }
      : fromStopSpec(strategy.takeProfit as StopSpec | undefined);

  return {
    name: strategy.name,
    longEntry: render(strategy.long?.entry),
    longExit: render(strategy.long?.exit),
    shortEntry: render(strategy.short?.entry),
    shortExit: render(strategy.short?.exit),

    stopMode: stop.mode,
    stopValue: stop.value,
    targetMode: target.mode,
    targetValue: target.value,
    trailMode: trail.mode,
    trailValue: trail.value,
    atrPeriod,

    sizingMode: strategy.sizing.mode,
    sizingValue: strategy.sizing.mode === "fixedLot" ? strategy.sizing.lots : strategy.sizing.percent,

    maxBarsInTrade: strategy.maxBarsInTrade ?? null,
    cooldownBars: strategy.cooldownBars ?? null,
    sessionEnabled: strategy.sessionUtc !== undefined,
    sessionStart: strategy.sessionUtc?.startHour ?? DEFAULT_FORM.sessionStart,
    sessionEnd: strategy.sessionUtc?.endHour ?? DEFAULT_FORM.sessionEnd,
  };
}

function fromStopSpec(spec: StopSpec | undefined): { mode: StopMode; value: number } {
  if (!spec) return { mode: "none", value: 2 };
  switch (spec.mode) {
    case "pips":
      return { mode: "pips", value: spec.value };
    case "percent":
      return { mode: "percent", value: spec.value };
    case "atr":
      return { mode: "atr", value: spec.multiple };
  }
}

function findAtrPeriod(strategy: Strategy): number | undefined {
  const referenced = [strategy.stopLoss, strategy.takeProfit, strategy.trailingStop].find(
    spec => spec?.mode === "atr",
  );
  const atrId = referenced?.mode === "atr" ? referenced.atrId : undefined;

  const spec = atrId
    ? strategy.indicators.find(i => i.id === atrId)
    : strategy.indicators.find((i): i is IndicatorSpec & { type: "atr" } => i.type === "atr");

  return spec?.type === "atr" ? spec.period : undefined;
}

/** Maps an engine validation path back to the form field that owns it. */
function fieldForPath(path: string): string {
  if (path.startsWith("sizing")) return "sizingValue";
  if (path.startsWith("stopLoss")) return "stopValue";
  if (path.startsWith("takeProfit")) return "targetValue";
  if (path.startsWith("trailingStop")) return "trailValue";
  if (path.startsWith("session")) return "sessionStart";
  if (path.startsWith("short")) return "shortEntry";
  return "longEntry";
}
