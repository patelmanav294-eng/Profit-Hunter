/**
 * The simulation loop.
 *
 * ── Execution model (the part that decides whether the numbers mean anything) ──
 *
 * 1. Signals are evaluated on the CLOSE of bar `i` and execute at the OPEN of
 *    bar `i+1`. Nothing is ever decided using a price the strategy could not
 *    have seen. This costs a bar of latency and is worth it.
 *
 * 2. Bars are treated as MID prices. Every fill pays half the spread, so a round
 *    trip pays exactly one full spread, symmetric for longs and shorts.
 *
 * 3. Stop and target levels are tested against the bar's high/low. When a single
 *    bar touches both, bar data cannot tell us which came first — the engine
 *    assumes the STOP filled first. Optimism here is how backtests come to show
 *    profits that never materialise. Override with `intrabarPriority` if you
 *    want to see the other side of the range.
 *
 * 4. A gap through a level fills at the open, not at the level. Stops do not
 *    protect you from gaps in real life and they should not here either.
 *
 * 5. Slippage is applied to market orders and stops (adversely, always) but not
 *    to take-profits, which are limit orders that fill at their price or not at all.
 */

import { compileIndicators, evaluateCondition, warmupBars, type IndicatorTable } from "./evaluate";
import { computeMetrics, type Metrics } from "./metrics";
import type { SizingSpec, StopSpec, Strategy, TargetSpec } from "./strategy";
import { validateStrategy } from "./strategy";
import type { Bar, CostModel, Direction, EquityPoint, ExitReason, Instrument, Trade } from "./types";

export interface BacktestConfig {
  instrument: Instrument;
  costs: CostModel;
  initialBalance: number;
  /**
   * Which level to assume filled first when one bar touches both stop and target.
   * Defaults to "pessimistic" (the stop).
   */
  intrabarPriority?: "pessimistic" | "optimistic";
}

export interface BacktestResult {
  strategyName: string;
  barCount: number;
  /** Bars consumed before every indicator had a value. */
  warmupBars: number;
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: Metrics;
  /** Signals that could not be sized above the instrument's minimum lot. */
  skippedForSize: number;
  /** True if equity hit zero and the run was abandoned. */
  ruined: boolean;
  config: BacktestConfig;
}

interface OpenPosition {
  direction: Direction;
  lots: number;
  entryBarIndex: number;
  entryTime: number;
  entryPrice: number;
  initialStopLoss?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Risk in account currency at entry, used for the R multiple. */
  riskAmount?: number;
  maxAdverseExcursion: number;
  maxFavorableExcursion: number;
}

export function runBacktest(bars: Bar[], strategy: Strategy, config: BacktestConfig): BacktestResult {
  const issues = validateStrategy(strategy);
  if (issues.length > 0) {
    const detail = issues.map(i => `  ${i.path}: ${i.message}`).join("\n");
    throw new Error(`Strategy "${strategy.name}" is not valid:\n${detail}`);
  }
  if (bars.length < 2) {
    throw new Error(`Backtest needs at least 2 bars, got ${bars.length}`);
  }
  assertBarsOrdered(bars);

  const { instrument, costs, initialBalance } = config;
  const pessimistic = (config.intrabarPriority ?? "pessimistic") === "pessimistic";
  const halfSpread = (costs.spreadPips * instrument.pipSize) / 2;
  const slip = costs.slippagePips * instrument.pipSize;

  const table = compileIndicators(bars, strategy.indicators);
  const warmup = warmupBars(strategy, table, bars.length);

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  let balance = initialBalance;
  let peakEquity = initialBalance;
  let position: OpenPosition | null = null;
  let pendingEntry: Direction | null = null;
  let pendingExit = false;
  let skippedForSize = 0;
  let ruined = false;
  let lastExitBarIndex = -Infinity;
  let tradeId = 0;

  const closePosition = (
    pos: OpenPosition,
    barIndex: number,
    rawExitPrice: number,
    reason: ExitReason,
    applySlippage: boolean,
  ): void => {
    const exitPrice = adjustFill(rawExitPrice, pos.direction, "exit", halfSpread, applySlippage ? slip : 0);
    const perUnit = pos.direction === "long" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const gross = perUnit * instrument.contractSize * pos.lots * instrument.quoteToAccountRate;
    const commission = costs.commissionPerLotPerSide * pos.lots * 2;
    const net = gross - commission;

    balance += net;

    trades.push({
      id: ++tradeId,
      direction: pos.direction,
      lots: pos.lots,
      entryBarIndex: pos.entryBarIndex,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitBarIndex: barIndex,
      exitTime: bars[barIndex].time,
      exitPrice,
      exitReason: reason,
      initialStopLoss: pos.initialStopLoss,
      takeProfit: pos.takeProfit,
      grossProfit: gross,
      commission,
      netProfit: net,
      rMultiple: pos.riskAmount && pos.riskAmount > 0 ? net / pos.riskAmount : undefined,
      barsHeld: barIndex - pos.entryBarIndex,
      equityAfter: balance,
      maxAdverseExcursion: pos.maxAdverseExcursion,
      maxFavorableExcursion: pos.maxFavorableExcursion,
    });

    lastExitBarIndex = barIndex;
    position = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // ── 1. A queued signal-exit fills at this bar's open ────────────────────
    if (position && pendingExit) {
      closePosition(position, i, bar.open, "signal", true);
      pendingExit = false;
    }

    // ── 2. Stops, targets and time limits on an already-open position ───────
    if (position) {
      updateExcursions(position, bar, instrument);
      const exit = checkIntrabarExit(position, bar, pessimistic);
      if (exit) {
        closePosition(position, i, exit.price, exit.reason, exit.reason !== "takeProfit");
      } else if (strategy.maxBarsInTrade !== undefined && i - position.entryBarIndex >= strategy.maxBarsInTrade) {
        closePosition(position, i, bar.close, "maxBars", true);
      } else {
        applyTrailingStop(position, bar, strategy.trailingStop, table, i, instrument);
      }
    }

    // ── 3. A queued entry fills at this bar's open ──────────────────────────
    if (!position && pendingEntry) {
      const direction: Direction = pendingEntry;
      const entryPrice = adjustFill(bar.open, direction, "entry", halfSpread, slip);
      const stopLoss = resolveStopPrice(entryPrice, direction, strategy.stopLoss, table, i, instrument);
      const takeProfit = resolveTargetPrice(
        entryPrice,
        direction,
        strategy.takeProfit,
        stopLoss,
        table,
        i,
        instrument,
      );
      const lots = resolveLots(strategy.sizing, balance, entryPrice, stopLoss, instrument);

      if (lots === null) {
        skippedForSize++;
      } else {
        const riskAmount =
          stopLoss === undefined
            ? undefined
            : Math.abs(entryPrice - stopLoss) * instrument.contractSize * lots * instrument.quoteToAccountRate;

        position = {
          direction,
          lots,
          entryBarIndex: i,
          entryTime: bar.time,
          entryPrice,
          initialStopLoss: stopLoss,
          stopLoss,
          takeProfit,
          riskAmount,
          maxAdverseExcursion: 0,
          maxFavorableExcursion: 0,
        };

        // A stop can be hit on the entry bar itself — check the rest of it.
        updateExcursions(position, bar, instrument);
        const exit = checkIntrabarExit(position, bar, pessimistic);
        if (exit) {
          closePosition(position, i, exit.price, exit.reason, exit.reason !== "takeProfit");
        } else {
          // Seed the trail immediately, otherwise a strategy whose only stop is
          // a trailing one rides its entry bar completely unprotected.
          applyTrailingStop(position, bar, strategy.trailingStop, table, i, instrument);
        }
      }
      pendingEntry = null;
    }

    // ── 4. Mark to market ──────────────────────────────────────────────────
    const openPnl = position ? unrealisedPnl(position, bar.close, instrument) : 0;
    const equity = balance + openPnl;
    if (equity > peakEquity) peakEquity = equity;
    equityCurve.push({
      time: bar.time,
      balance,
      equity,
      drawdown: peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0,
    });

    // A blown account cannot keep trading; stop rather than report fantasy stats.
    if (equity <= 0) {
      if (position) closePosition(position, i, bar.close, "endOfData", true);
      ruined = true;
      break;
    }

    // ── 5. Evaluate signals on this close, to execute at the next open ──────
    if (i + 1 >= bars.length) break;

    if (position) {
      const side = position.direction === "long" ? strategy.long : strategy.short;
      if (side?.exit && evaluateCondition(side.exit, bars, table, i)) {
        pendingExit = true;
        // If the opposite side wants in on the same close, queue the reversal so
        // both legs fill at the next open, the way a broker would handle it.
        const opposite: Direction = position.direction === "long" ? "short" : "long";
        const oppositeRules = opposite === "long" ? strategy.long : strategy.short;
        if (oppositeRules && canEnter(strategy, bars, i, lastExitBarIndex) && evaluateCondition(oppositeRules.entry, bars, table, i)) {
          pendingEntry = opposite;
        }
      }
    } else if (!pendingEntry && canEnter(strategy, bars, i, lastExitBarIndex)) {
      if (strategy.long && evaluateCondition(strategy.long.entry, bars, table, i)) {
        pendingEntry = "long";
      } else if (strategy.short && evaluateCondition(strategy.short.entry, bars, table, i)) {
        pendingEntry = "short";
      }
    }
  }

  // Anything still open when the data runs out is closed at the last close, and
  // labelled so it can be excluded from stats if you would rather not count it.
  if (position && !ruined) {
    const lastIndex = bars.length - 1;
    closePosition(position, lastIndex, bars[lastIndex].close, "endOfData", true);
    const last = equityCurve[equityCurve.length - 1];
    if (last) {
      last.balance = balance;
      last.equity = balance;
      if (balance > peakEquity) peakEquity = balance;
      last.drawdown = peakEquity > 0 ? (peakEquity - balance) / peakEquity : 0;
    }
  }

  return {
    strategyName: strategy.name,
    barCount: bars.length,
    warmupBars: warmup,
    trades,
    equityCurve,
    metrics: computeMetrics(trades, equityCurve, initialBalance, bars),
    skippedForSize,
    ruined,
    config,
  };
}

/** Session and cooldown filters that gate any new entry. */
function canEnter(strategy: Strategy, bars: Bar[], index: number, lastExitBarIndex: number): boolean {
  if (strategy.cooldownBars !== undefined && index - lastExitBarIndex <= strategy.cooldownBars) {
    return false;
  }
  if (strategy.sessionUtc) {
    // The entry executes on the NEXT bar, so the session test applies to that bar.
    const next = bars[index + 1];
    if (!next) return false;
    const hour = new Date(next.time).getUTCHours();
    const { startHour, endHour } = strategy.sessionUtc;
    const inSession =
      startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
    if (!inSession) return false;
  }
  return true;
}

/** Applies half-spread and slippage in the direction that costs the trader money. */
function adjustFill(
  price: number,
  direction: Direction,
  side: "entry" | "exit",
  halfSpread: number,
  slippage: number,
): number {
  const buying = (direction === "long") === (side === "entry");
  return buying ? price + halfSpread + slippage : price - halfSpread - slippage;
}

interface IntrabarExit {
  price: number;
  reason: ExitReason;
}

function checkIntrabarExit(pos: OpenPosition, bar: Bar, pessimistic: boolean): IntrabarExit | null {
  const { stopLoss, takeProfit, direction } = pos;
  const isTrailing = stopLoss !== undefined && stopLoss !== pos.initialStopLoss;
  const stopReason: ExitReason = isTrailing ? "trailingStop" : "stopLoss";

  if (direction === "long") {
    // Gap handling: an open beyond the level fills at the open, not the level.
    if (stopLoss !== undefined && bar.open <= stopLoss) return { price: bar.open, reason: stopReason };
    if (takeProfit !== undefined && bar.open >= takeProfit) return { price: bar.open, reason: "takeProfit" };

    const stopHit = stopLoss !== undefined && bar.low <= stopLoss;
    const targetHit = takeProfit !== undefined && bar.high >= takeProfit;
    if (stopHit && targetHit) {
      return pessimistic
        ? { price: stopLoss!, reason: stopReason }
        : { price: takeProfit!, reason: "takeProfit" };
    }
    if (stopHit) return { price: stopLoss!, reason: stopReason };
    if (targetHit) return { price: takeProfit!, reason: "takeProfit" };
    return null;
  }

  if (stopLoss !== undefined && bar.open >= stopLoss) return { price: bar.open, reason: stopReason };
  if (takeProfit !== undefined && bar.open <= takeProfit) return { price: bar.open, reason: "takeProfit" };

  const stopHit = stopLoss !== undefined && bar.high >= stopLoss;
  const targetHit = takeProfit !== undefined && bar.low <= takeProfit;
  if (stopHit && targetHit) {
    return pessimistic ? { price: stopLoss!, reason: stopReason } : { price: takeProfit!, reason: "takeProfit" };
  }
  if (stopHit) return { price: stopLoss!, reason: stopReason };
  if (targetHit) return { price: takeProfit!, reason: "takeProfit" };
  return null;
}

/**
 * Ratchets the stop in the trade's favour, measured from the bar CLOSE.
 *
 * Trailing from the bar's extreme would assume the stop moved before the price
 * came back — an assumption bar data cannot support.
 */
function applyTrailingStop(
  pos: OpenPosition,
  bar: Bar,
  spec: StopSpec | undefined,
  table: IndicatorTable,
  index: number,
  instrument: Instrument,
): void {
  if (!spec) return;
  const distance = stopDistance(spec, bar.close, table, index, instrument);
  if (distance === undefined) return;

  if (pos.direction === "long") {
    const candidate = bar.close - distance;
    if (pos.stopLoss === undefined || candidate > pos.stopLoss) pos.stopLoss = candidate;
  } else {
    const candidate = bar.close + distance;
    if (pos.stopLoss === undefined || candidate < pos.stopLoss) pos.stopLoss = candidate;
  }
}

function stopDistance(
  spec: StopSpec,
  referencePrice: number,
  table: IndicatorTable,
  index: number,
  instrument: Instrument,
): number | undefined {
  switch (spec.mode) {
    case "pips":
      return spec.value * instrument.pipSize;
    case "percent":
      return (referencePrice * spec.value) / 100;
    case "atr": {
      const atrValue = table[spec.atrId]?.[index];
      return atrValue === undefined ? undefined : atrValue * spec.multiple;
    }
  }
}

function resolveStopPrice(
  entryPrice: number,
  direction: Direction,
  spec: StopSpec | undefined,
  table: IndicatorTable,
  index: number,
  instrument: Instrument,
): number | undefined {
  if (!spec) return undefined;
  const distance = stopDistance(spec, entryPrice, table, index, instrument);
  if (distance === undefined) return undefined;
  return direction === "long" ? entryPrice - distance : entryPrice + distance;
}

function resolveTargetPrice(
  entryPrice: number,
  direction: Direction,
  spec: TargetSpec | undefined,
  stopPrice: number | undefined,
  table: IndicatorTable,
  index: number,
  instrument: Instrument,
): number | undefined {
  if (!spec) return undefined;

  let distance: number | undefined;
  if (spec.mode === "riskReward") {
    if (stopPrice === undefined) return undefined;
    distance = Math.abs(entryPrice - stopPrice) * spec.ratio;
  } else {
    distance = stopDistance(spec, entryPrice, table, index, instrument);
  }
  if (distance === undefined) return undefined;
  return direction === "long" ? entryPrice + distance : entryPrice - distance;
}

/**
 * Returns the lot size for a new position, or `null` when the instrument's
 * minimum lot would force more risk than the strategy allows.
 */
function resolveLots(
  sizing: SizingSpec,
  equity: number,
  entryPrice: number,
  stopPrice: number | undefined,
  instrument: Instrument,
): number | null {
  if (sizing.mode === "fixedLot") {
    return clampLots(sizing.lots, instrument);
  }

  if (stopPrice === undefined) return null;
  const stopDistancePrice = Math.abs(entryPrice - stopPrice);
  if (stopDistancePrice <= 0) return null;

  const riskAmount = (equity * sizing.percent) / 100;
  const lossPerLot = stopDistancePrice * instrument.contractSize * instrument.quoteToAccountRate;
  if (lossPerLot <= 0) return null;

  const raw = riskAmount / lossPerLot;
  // Round DOWN to the lot step so rounding never increases risk beyond the budget.
  const stepped = Math.floor(raw / instrument.lotStep) * instrument.lotStep;
  if (stepped < instrument.minLot) return null;
  return clampLots(stepped, instrument);
}

function clampLots(lots: number, instrument: Instrument): number | null {
  const stepped = Math.floor(lots / instrument.lotStep) * instrument.lotStep;
  if (stepped < instrument.minLot) return null;
  const capped = Math.min(stepped, instrument.maxLot);
  // Guard against binary-float dust like 0.30000000000000004 lots.
  return Number(capped.toFixed(8));
}

function unrealisedPnl(pos: OpenPosition, price: number, instrument: Instrument): number {
  const perUnit = pos.direction === "long" ? price - pos.entryPrice : pos.entryPrice - price;
  return perUnit * instrument.contractSize * pos.lots * instrument.quoteToAccountRate;
}

function updateExcursions(pos: OpenPosition, bar: Bar, instrument: Instrument): void {
  const worstPrice = pos.direction === "long" ? bar.low : bar.high;
  const bestPrice = pos.direction === "long" ? bar.high : bar.low;
  const worst = unrealisedPnl(pos, worstPrice, instrument);
  const best = unrealisedPnl(pos, bestPrice, instrument);
  if (worst < pos.maxAdverseExcursion) pos.maxAdverseExcursion = worst;
  if (best > pos.maxFavorableExcursion) pos.maxFavorableExcursion = best;
}

function assertBarsOrdered(bars: Bar[]): void {
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].time <= bars[i - 1].time) {
      throw new Error(
        `Bars must be sorted by ascending time with no duplicates — bar ${i} (${new Date(
          bars[i].time,
        ).toISOString()}) does not follow bar ${i - 1} (${new Date(bars[i - 1].time).toISOString()})`,
      );
    }
  }
}
