import { describe, expect, it } from "vitest";

import { computeMetrics } from "../src/engine/metrics";
import type { Bar, EquityPoint, ExitReason, Trade } from "../src/engine/types";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function mkTrade(overrides: Partial<Trade> & { id: number; netProfit: number }): Trade {
  return {
    direction: "long",
    lots: 1,
    entryBarIndex: overrides.id,
    entryTime: START,
    entryPrice: 100,
    exitBarIndex: overrides.id + 1,
    exitTime: START + DAY,
    exitPrice: 100,
    exitReason: "signal" as ExitReason,
    grossProfit: overrides.netProfit,
    commission: 0,
    barsHeld: 1,
    equityAfter: 0,
    maxAdverseExcursion: 0,
    maxFavorableExcursion: 0,
    ...overrides,
  };
}

function mkBars(count: number, intervalMs = DAY): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: START + i * intervalMs,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
  }));
}

function mkCurve(equities: number[], intervalMs = DAY): EquityPoint[] {
  let peak = equities[0];
  return equities.map((equity, i) => {
    if (equity > peak) peak = equity;
    return {
      time: START + i * intervalMs,
      balance: equity,
      equity,
      drawdown: peak > 0 ? (peak - equity) / peak : 0,
    };
  });
}

describe("computeMetrics", () => {
  // Wins first, then losses, so the streak counters have something to find.
  const trades: Trade[] = [
    mkTrade({ id: 1, netProfit: 200, rMultiple: 2 }),
    mkTrade({ id: 2, netProfit: 300, rMultiple: 3 }),
    mkTrade({ id: 3, netProfit: -100, rMultiple: -1 }),
    mkTrade({ id: 4, netProfit: -100, rMultiple: -1 }),
  ];
  const curve = mkCurve([10_000, 10_200, 10_500, 10_400, 10_300]);
  const metrics = computeMetrics(trades, curve, 10_000, mkBars(5));

  it("counts wins, losses and the win rate", () => {
    expect(metrics.totalTrades).toBe(4);
    expect(metrics.wins).toBe(2);
    expect(metrics.losses).toBe(2);
    expect(metrics.breakEven).toBe(0);
    expect(metrics.winRate).toBeCloseTo(0.5, 10);
  });

  it("sums profit and loss into a profit factor", () => {
    expect(metrics.grossProfit).toBeCloseTo(500, 10);
    expect(metrics.grossLoss).toBeCloseTo(200, 10);
    expect(metrics.netProfit).toBeCloseTo(300, 10);
    expect(metrics.netProfitPercent).toBeCloseTo(3, 10);
    expect(metrics.profitFactor).toBeCloseTo(2.5, 10);
  });

  it("averages the per-trade outcome", () => {
    expect(metrics.expectancy).toBeCloseTo(75, 10);
    expect(metrics.expectancyR).toBeCloseTo(0.75, 10);
    expect(metrics.avgWin).toBeCloseTo(250, 10);
    expect(metrics.avgLoss).toBeCloseTo(-100, 10);
    expect(metrics.payoffRatio).toBeCloseTo(2.5, 10);
    expect(metrics.largestWin).toBeCloseTo(300, 10);
    expect(metrics.largestLoss).toBeCloseTo(-100, 10);
  });

  it("measures drawdown from the running equity peak", () => {
    // Peak 10,500 then down to 10,300 — 200 absolute, 1.905% relative, 2 bars long.
    expect(metrics.maxDrawdown).toBeCloseTo(200, 10);
    expect(metrics.maxDrawdownPercent).toBeCloseTo((200 / 10_500) * 100, 10);
    expect(metrics.maxDrawdownBars).toBe(2);
  });

  it("tracks the longest winning and losing streaks", () => {
    expect(metrics.longestWinStreak).toBe(2);
    expect(metrics.longestLossStreak).toBe(2);
  });

  it("breaks results down by direction", () => {
    expect(metrics.long.trades).toBe(4);
    expect(metrics.long.netProfit).toBeCloseTo(300, 10);
    expect(metrics.short.trades).toBe(0);
    expect(metrics.short.winRate).toBe(0);
  });
});

describe("edge cases", () => {
  it("returns zeroed stats for a strategy that never traded", () => {
    const metrics = computeMetrics([], mkCurve([10_000, 10_000, 10_000]), 10_000, mkBars(3));
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.expectancy).toBe(0);
    expect(metrics.expectancyR).toBeUndefined();
    expect(metrics.maxDrawdown).toBe(0);
  });

  it("reports an infinite profit factor when nothing lost", () => {
    const trades = [mkTrade({ id: 1, netProfit: 100 }), mkTrade({ id: 2, netProfit: 50 })];
    const metrics = computeMetrics(trades, mkCurve([10_000, 10_100, 10_150]), 10_000, mkBars(3));
    expect(metrics.profitFactor).toBe(Infinity);
    expect(metrics.payoffRatio).toBe(Infinity);
  });

  it("omits expectancyR when the strategy trades without stops", () => {
    const trades = [mkTrade({ id: 1, netProfit: 100 }), mkTrade({ id: 2, netProfit: -50 })];
    const metrics = computeMetrics(trades, mkCurve([10_000, 10_100, 10_050]), 10_000, mkBars(3));
    expect(metrics.expectancyR).toBeUndefined();
  });

  it("counts a zero-profit trade as neither win nor loss", () => {
    const trades = [mkTrade({ id: 1, netProfit: 0 })];
    const metrics = computeMetrics(trades, mkCurve([10_000, 10_000]), 10_000, mkBars(2));
    expect(metrics.wins).toBe(0);
    expect(metrics.losses).toBe(0);
    expect(metrics.breakEven).toBe(1);
  });
});

describe("annualised figures", () => {
  it("computes CAGR over the data's calendar span", () => {
    // 3% gained across exactly one year is a 3% CAGR.
    const curve = mkCurve([10_000, 10_300]);
    curve[1].time = curve[0].time + Math.round(365.25 * DAY);
    const barsOverAYear: Bar[] = [
      { time: curve[0].time, open: 100, high: 100, low: 100, close: 100 },
      { time: curve[1].time, open: 100, high: 100, low: 100, close: 100 },
    ];

    const metrics = computeMetrics([], curve, 10_000, barsOverAYear);
    expect(metrics.periodDays).toBeCloseTo(365.25, 1);
    expect(metrics.cagr).toBeCloseTo(0.03, 6);
  });

  it("gives a positive Sharpe to a rising but bumpy curve", () => {
    // Upward drift with a wobble large enough to produce genuine down bars,
    // so both denominators are non-zero and the ratios stay finite.
    const equities = Array.from({ length: 60 }, (_, i) => 10_000 * 1.001 ** i * (1 + 0.002 * Math.sin(i)));
    const metrics = computeMetrics([], mkCurve(equities), 10_000, mkBars(60));

    expect(metrics.sharpe).toBeGreaterThan(0);
    expect(Number.isFinite(metrics.sharpe)).toBe(true);
    expect(metrics.sortino).toBeGreaterThan(0);
    expect(Number.isFinite(metrics.sortino)).toBe(true);
  });

  it("reports an infinite Sortino when a profitable curve never had a down bar", () => {
    // No downside deviation to divide by. Reporting 0 here would read as "no
    // risk-adjusted return" for what is actually the best possible case.
    const equities = Array.from({ length: 40 }, (_, i) => 10_000 * 1.001 ** i);
    const metrics = computeMetrics([], mkCurve(equities), 10_000, mkBars(40));

    expect(metrics.sortino).toBe(Infinity);
    // Sharpe divides by total deviation, and compounding leaves float dust in
    // the returns, so it lands on something enormous rather than exactly Infinity.
    expect(metrics.sharpe).toBeGreaterThan(1000);
  });

  it("gives a negative Sharpe to a steadily falling curve", () => {
    const equities = Array.from({ length: 60 }, (_, i) => 10_000 * 0.999 ** i);
    const metrics = computeMetrics([], mkCurve(equities), 10_000, mkBars(60));
    expect(metrics.sharpe).toBeLessThan(0);
  });

  it("reports zero Sharpe for a flat curve rather than dividing by zero", () => {
    const metrics = computeMetrics([], mkCurve(new Array(30).fill(10_000)), 10_000, mkBars(30));
    expect(metrics.sharpe).toBe(0);
    expect(metrics.sortino).toBe(0);
    expect(Number.isFinite(metrics.sharpe)).toBe(true);
  });
});

describe("exposure and exit reasons", () => {
  it("reports the share of bars spent in a position", () => {
    const trades = [
      mkTrade({ id: 1, netProfit: 10, barsHeld: 20 }),
      mkTrade({ id: 2, netProfit: -5, barsHeld: 30 }),
    ];
    const metrics = computeMetrics(trades, mkCurve([10_000, 10_010, 10_005]), 10_000, mkBars(100));
    expect(metrics.exposure).toBeCloseTo(0.5, 10);
    expect(metrics.avgBarsHeld).toBeCloseTo(25, 10);
  });

  it("tallies how each trade ended", () => {
    const trades = [
      mkTrade({ id: 1, netProfit: 10, exitReason: "takeProfit" }),
      mkTrade({ id: 2, netProfit: -5, exitReason: "stopLoss" }),
      mkTrade({ id: 3, netProfit: -5, exitReason: "stopLoss" }),
    ];
    const metrics = computeMetrics(trades, mkCurve([10_000, 10_010, 10_005, 10_000]), 10_000, mkBars(4));
    expect(metrics.exitReasons.takeProfit).toBe(1);
    expect(metrics.exitReasons.stopLoss).toBe(2);
    expect(metrics.exitReasons.signal).toBe(0);
  });
});
