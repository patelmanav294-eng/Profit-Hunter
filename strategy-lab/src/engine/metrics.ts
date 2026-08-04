/**
 * Performance statistics.
 *
 * The point of this file is to be unflattering. Net profit alone hides ruin
 * risk, so every headline number sits next to the drawdown, the trade count and
 * the streaks needed to judge whether the result is skill or a small sample.
 */

import type { Bar, EquityPoint, ExitReason, Trade } from "./types";

export interface SideBreakdown {
  trades: number;
  wins: number;
  winRate: number;
  netProfit: number;
}

export interface Metrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number;

  netProfit: number;
  netProfitPercent: number;
  grossProfit: number;
  grossLoss: number;
  totalCommission: number;
  /** Gross profit / gross loss. `Infinity` when there are no losing trades. */
  profitFactor: number;

  /** Average net profit per trade, in account currency. */
  expectancy: number;
  /** Average R multiple per trade. `undefined` when the strategy trades without stops. */
  expectancyR?: number;

  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  /** Average win / average loss. `Infinity` when there are no losing trades. */
  payoffRatio: number;

  maxDrawdown: number;
  maxDrawdownPercent: number;
  /** Longest stretch, in bars, spent below a previous equity peak. */
  maxDrawdownBars: number;

  /** Annualised, risk-free rate assumed zero. */
  sharpe: number;
  sortino: number;
  /** Compound annual growth rate, as a fraction (0.15 = 15%/yr). */
  cagr: number;

  longestWinStreak: number;
  longestLossStreak: number;
  avgBarsHeld: number;
  /** Fraction of bars spent holding a position. */
  exposure: number;

  exitReasons: Record<ExitReason, number>;
  long: SideBreakdown;
  short: SideBreakdown;

  /** Calendar days spanned by the data. */
  periodDays: number;
}

export function computeMetrics(
  trades: Trade[],
  equityCurve: EquityPoint[],
  initialBalance: number,
  bars: Bar[],
): Metrics {
  const wins = trades.filter(t => t.netProfit > 0);
  const losses = trades.filter(t => t.netProfit < 0);
  const breakEven = trades.length - wins.length - losses.length;

  const grossProfit = wins.reduce((sum, t) => sum + t.netProfit, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netProfit, 0));
  const netProfit = trades.reduce((sum, t) => sum + t.netProfit, 0);
  const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);

  const rMultiples = trades.map(t => t.rMultiple).filter((r): r is number => r !== undefined);

  const drawdown = computeDrawdown(equityCurve);
  const { sharpe, sortino } = computeRiskAdjusted(equityCurve, bars);

  const periodMs = bars.length > 1 ? bars[bars.length - 1].time - bars[0].time : 0;
  const periodDays = periodMs / 86_400_000;
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialBalance;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakEven,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,

    netProfit,
    netProfitPercent: initialBalance > 0 ? (netProfit / initialBalance) * 100 : 0,
    grossProfit,
    grossLoss,
    totalCommission,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,

    expectancy: trades.length > 0 ? netProfit / trades.length : 0,
    expectancyR: rMultiples.length > 0 ? mean(rMultiples) : undefined,

    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.netProfit)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.netProfit)) : 0,
    payoffRatio: computePayoff(wins, losses, grossProfit, grossLoss),

    maxDrawdown: drawdown.maxDrawdown,
    maxDrawdownPercent: drawdown.maxDrawdownPercent,
    maxDrawdownBars: drawdown.maxDrawdownBars,

    sharpe,
    sortino,
    cagr: computeCagr(initialBalance, finalEquity, periodDays),

    longestWinStreak: longestStreak(trades, t => t.netProfit > 0),
    longestLossStreak: longestStreak(trades, t => t.netProfit < 0),
    avgBarsHeld: trades.length > 0 ? mean(trades.map(t => t.barsHeld)) : 0,
    exposure: bars.length > 0 ? trades.reduce((sum, t) => sum + t.barsHeld, 0) / bars.length : 0,

    exitReasons: countExitReasons(trades),
    long: sideBreakdown(trades, "long"),
    short: sideBreakdown(trades, "short"),

    periodDays,
  };
}

function computePayoff(wins: Trade[], losses: Trade[], grossProfit: number, grossLoss: number): number {
  if (wins.length === 0) return 0;
  if (losses.length === 0) return Infinity;
  const avgWin = grossProfit / wins.length;
  const avgLoss = grossLoss / losses.length;
  return avgLoss > 0 ? avgWin / avgLoss : Infinity;
}

interface DrawdownResult {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownBars: number;
}

function computeDrawdown(equityCurve: EquityPoint[]): DrawdownResult {
  let peak = equityCurve.length > 0 ? equityCurve[0].equity : 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let maxDrawdownBars = 0;
  let currentBars = 0;

  for (const point of equityCurve) {
    if (point.equity >= peak) {
      peak = point.equity;
      currentBars = 0;
      continue;
    }
    currentBars++;
    if (currentBars > maxDrawdownBars) maxDrawdownBars = currentBars;

    const absolute = peak - point.equity;
    if (absolute > maxDrawdown) maxDrawdown = absolute;
    const percent = peak > 0 ? (absolute / peak) * 100 : 0;
    if (percent > maxDrawdownPercent) maxDrawdownPercent = percent;
  }

  return { maxDrawdown, maxDrawdownPercent, maxDrawdownBars };
}

/**
 * Sharpe and Sortino from per-bar equity returns.
 *
 * Annualisation infers the bar interval from the data's median spacing and
 * treats the year as continuous. For instruments that stop trading at weekends
 * this slightly overstates the number of periods, so read these as comparative
 * figures between strategies on the same data rather than absolute truth.
 */
function computeRiskAdjusted(equityCurve: EquityPoint[], bars: Bar[]): { sharpe: number; sortino: number } {
  if (equityCurve.length < 3) return { sharpe: 0, sortino: 0 };

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev <= 0) continue;
    returns.push((equityCurve[i].equity - prev) / prev);
  }
  if (returns.length < 2) return { sharpe: 0, sortino: 0 };

  const avg = mean(returns);
  const sd = stdev(returns, avg);
  const downside = returns.filter(r => r < 0);
  const downsideDeviation =
    downside.length > 0 ? Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / returns.length) : 0;

  const periodsPerYear = inferPeriodsPerYear(bars);
  const scale = Math.sqrt(periodsPerYear);

  // A zero denominator means there was no variability to divide by. If the
  // average return is positive that is an unbounded ratio, reported as Infinity
  // for the same reason profit factor is; a flat or losing curve reports 0.
  return {
    sharpe: sd > 0 ? (avg / sd) * scale : avg > 0 ? Infinity : 0,
    sortino: downsideDeviation > 0 ? (avg / downsideDeviation) * scale : avg > 0 ? Infinity : 0,
  };
}

function inferPeriodsPerYear(bars: Bar[]): number {
  if (bars.length < 2) return 252;
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i++) gaps.push(bars[i].time - bars[i - 1].time);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (!median || median <= 0) return 252;
  return 365.25 * 86_400_000 / median;
}

function computeCagr(initialBalance: number, finalEquity: number, periodDays: number): number {
  if (initialBalance <= 0 || finalEquity <= 0 || periodDays <= 0) return 0;
  const years = periodDays / 365.25;
  if (years <= 0) return 0;
  return Math.pow(finalEquity / initialBalance, 1 / years) - 1;
}

function longestStreak(trades: Trade[], predicate: (t: Trade) => boolean): number {
  let longest = 0;
  let current = 0;
  for (const trade of trades) {
    if (predicate(trade)) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

function countExitReasons(trades: Trade[]): Record<ExitReason, number> {
  const counts: Record<ExitReason, number> = {
    stopLoss: 0,
    takeProfit: 0,
    trailingStop: 0,
    signal: 0,
    maxBars: 0,
    endOfData: 0,
  };
  for (const trade of trades) counts[trade.exitReason]++;
  return counts;
}

function sideBreakdown(trades: Trade[], direction: "long" | "short"): SideBreakdown {
  const subset = trades.filter(t => t.direction === direction);
  const wins = subset.filter(t => t.netProfit > 0).length;
  return {
    trades: subset.length,
    wins,
    winRate: subset.length > 0 ? wins / subset.length : 0,
    netProfit: subset.reduce((sum, t) => sum + t.netProfit, 0),
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[], avg: number): number {
  // Sample standard deviation — returns are a sample of the process, not the whole of it.
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
