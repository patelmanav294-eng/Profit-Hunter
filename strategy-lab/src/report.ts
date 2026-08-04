/**
 * Text report formatting, shared by the CLI and anything else that wants a
 * human-readable summary of a run.
 */

import type { BacktestResult } from "./engine/backtest";
import type { Metrics } from "./engine/metrics";
import type { Trade } from "./engine/types";

export function formatMoney(value: number, currency = "$"): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${currency}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

/** Renders `Infinity` as a symbol rather than the word, which reads as a bug. */
export function formatRatio(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(digits);
}

export function formatDate(time: number): string {
  return new Date(time).toISOString().replace("T", " ").slice(0, 16);
}

export function formatReport(result: BacktestResult): string {
  const m = result.metrics;
  const lines: string[] = [];
  const rule = "─".repeat(58);

  lines.push(rule);
  lines.push(`  ${result.strategyName}`);
  lines.push(`  ${result.config.instrument.symbol}  ·  ${result.barCount.toLocaleString()} bars  ·  ${m.periodDays.toFixed(0)} days`);
  lines.push(rule);
  lines.push("");

  lines.push(section("Result"));
  lines.push(row("Net profit", `${formatMoney(m.netProfit)}  (${formatPercent(m.netProfitPercent)})`));
  lines.push(row("Final equity", formatMoney(result.config.initialBalance + m.netProfit)));
  lines.push(row("CAGR", formatPercent(m.cagr * 100)));
  lines.push(row("Max drawdown", `${formatMoney(m.maxDrawdown)}  (${formatPercent(m.maxDrawdownPercent)})`));
  lines.push(row("Longest drawdown", `${m.maxDrawdownBars} bars`));
  lines.push("");

  lines.push(section("Trades"));
  lines.push(row("Total", String(m.totalTrades)));
  lines.push(row("Win rate", `${formatPercent(m.winRate * 100)}  (${m.wins}W / ${m.losses}L / ${m.breakEven}BE)`));
  lines.push(row("Profit factor", formatRatio(m.profitFactor)));
  lines.push(row("Expectancy", `${formatMoney(m.expectancy)} per trade`));
  if (m.expectancyR !== undefined) {
    lines.push(row("Expectancy (R)", `${m.expectancyR >= 0 ? "+" : ""}${m.expectancyR.toFixed(3)}R`));
  }
  lines.push(row("Payoff ratio", formatRatio(m.payoffRatio)));
  lines.push(row("Average win", formatMoney(m.avgWin)));
  lines.push(row("Average loss", formatMoney(m.avgLoss)));
  lines.push(row("Largest win", formatMoney(m.largestWin)));
  lines.push(row("Largest loss", formatMoney(m.largestLoss)));
  lines.push(row("Longest streaks", `${m.longestWinStreak}W  /  ${m.longestLossStreak}L`));
  lines.push("");

  lines.push(section("Risk"));
  lines.push(row("Sharpe (annualised)", formatRatio(m.sharpe)));
  lines.push(row("Sortino (annualised)", formatRatio(m.sortino)));
  lines.push(row("Exposure", formatPercent(m.exposure * 100)));
  lines.push(row("Avg bars held", m.avgBarsHeld.toFixed(1)));
  lines.push(row("Commission paid", formatMoney(m.totalCommission)));
  lines.push("");

  lines.push(section("By direction"));
  lines.push(row("Long", sideLine(m, "long")));
  lines.push(row("Short", sideLine(m, "short")));
  lines.push("");

  lines.push(section("How trades ended"));
  for (const [reason, count] of Object.entries(m.exitReasons)) {
    if (count === 0) continue;
    lines.push(row(`  ${reason}`, `${count}  (${formatPercent((count / Math.max(m.totalTrades, 1)) * 100, 1)})`));
  }
  lines.push("");

  const warnings = collectWarnings(result);
  if (warnings.length > 0) {
    lines.push(section("Read this before believing the numbers"));
    for (const warning of warnings) lines.push(`  ! ${warning}`);
    lines.push("");
  }

  return lines.join("\n");
}

function section(title: string): string {
  return `  ${title.toUpperCase()}`;
}

function row(label: string, value: string): string {
  return `    ${label.padEnd(24)}${value}`;
}

function sideLine(m: Metrics, side: "long" | "short"): string {
  const s = m[side];
  if (s.trades === 0) return "none";
  return `${s.trades} trades  ·  ${formatPercent(s.winRate * 100, 1)} win  ·  ${formatMoney(s.netProfit)}`;
}

/**
 * The caveats that decide whether a result is worth acting on.
 *
 * A backtest's headline number is the least interesting thing about it; these
 * are the conditions under which that number does not mean what it appears to.
 */
export function collectWarnings(result: BacktestResult): string[] {
  const m = result.metrics;
  const warnings: string[] = [];

  if (m.totalTrades < 30) {
    warnings.push(
      `Only ${m.totalTrades} trades — far too few to separate edge from luck. Treat every statistic here as noise.`,
    );
  } else if (m.totalTrades < 100) {
    warnings.push(`${m.totalTrades} trades is a thin sample; confidence intervals on the win rate are wide.`);
  }

  if (result.ruined) {
    warnings.push("Equity reached zero and the run was abandoned. The account blew up.");
  }

  if (m.maxDrawdownPercent > 30) {
    warnings.push(
      `Max drawdown of ${formatPercent(m.maxDrawdownPercent)} — most people stop trading a system long before this.`,
    );
  }

  if (result.skippedForSize > 0) {
    warnings.push(
      `${result.skippedForSize} signals were skipped because the position could not be sized above the minimum lot.`,
    );
  }

  const endOfData = m.exitReasons.endOfData;
  if (endOfData > 0 && m.totalTrades > 0 && endOfData / m.totalTrades > 0.1) {
    warnings.push(
      `${endOfData} trades were force-closed when the data ran out, not by the strategy's own rules.`,
    );
  }

  if (m.exitReasons.maxBars > 0 && m.exitReasons.maxBars / Math.max(m.totalTrades, 1) > 0.5) {
    warnings.push("Over half the trades hit the time stop — the exit rules are barely doing anything.");
  }

  if (result.warmupBars > result.barCount * 0.25) {
    warnings.push(
      `Indicators needed ${result.warmupBars} of ${result.barCount} bars to warm up, leaving little history to trade.`,
    );
  }

  if (result.config.costs.spreadPips === 0 && result.config.costs.commissionPerLotPerSide === 0) {
    warnings.push("Costs were set to zero. Real fills pay a spread; re-run with realistic figures.");
  }

  if (m.exposure > 0.95) {
    warnings.push("The strategy was in the market almost constantly — this is closer to buy-and-hold than trading.");
  }

  return warnings;
}

/** A compact trade table, newest last. */
export function formatTrades(trades: Trade[], limit = 20): string {
  if (trades.length === 0) return "  No trades.";

  const shown = trades.slice(-limit);
  const header = `    ${"#".padEnd(5)}${"Side".padEnd(7)}${"Entry".padEnd(18)}${"Exit".padEnd(18)}${"Lots".padEnd(8)}${"Reason".padEnd(14)}${"Net".padStart(12)}`;
  const rows = shown.map(t =>
    [
      `    ${String(t.id).padEnd(5)}`,
      t.direction.padEnd(7),
      `${formatDate(t.entryTime)} `.padEnd(18),
      `${formatDate(t.exitTime)} `.padEnd(18),
      t.lots.toFixed(2).padEnd(8),
      t.exitReason.padEnd(14),
      formatMoney(t.netProfit).padStart(12),
    ].join(""),
  );

  const omitted = trades.length - shown.length;
  const footer = omitted > 0 ? [`    … ${omitted} earlier trades omitted`] : [];
  return [header, ...rows, ...footer].join("\n");
}
