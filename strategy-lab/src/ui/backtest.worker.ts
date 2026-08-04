/**
 * Runs backtests off the main thread.
 *
 * A few hundred thousand bars with a handful of indicators takes long enough to
 * freeze the page, and the noise check multiplies that by however many runs it
 * is asked for. Everything crossing the boundary is plain data, so it clones
 * without any custom serialisation.
 */

import { generateBars } from "../data/synthetic";
import { runBacktest, type BacktestConfig, type BacktestResult } from "../engine/backtest";
import type { Strategy } from "../engine/strategy";
import type { Bar } from "../engine/types";

export interface RunMessage {
  id: number;
  kind: "run";
  bars: Bar[];
  strategy: Strategy;
  config: BacktestConfig;
  /** How many zero-drift random-walk runs to compare against. 0 skips the check. */
  noiseRuns: number;
  /** Volatility for the noise runs, matched to the real data by the caller. */
  noiseVolatility: number;
}

export interface NoiseSummary {
  runs: number;
  mean: number;
  median: number;
  best: number;
  worst: number;
  profitable: number;
  /** Share of noise runs the real result beat, 0..1. */
  percentile: number;
}

export type ResponseMessage =
  | { id: number; kind: "progress"; phase: string }
  | { id: number; kind: "done"; result: BacktestResult; noise?: NoiseSummary }
  | { id: number; kind: "error"; message: string };

self.onmessage = (event: MessageEvent<RunMessage>) => {
  const message = event.data;
  if (message.kind !== "run") return;

  const reply = (response: ResponseMessage) => self.postMessage(response);

  try {
    reply({ id: message.id, kind: "progress", phase: "Running backtest" });
    const result = runBacktest(message.bars, message.strategy, message.config);

    let noise: NoiseSummary | undefined;
    if (message.noiseRuns > 0) {
      reply({ id: message.id, kind: "progress", phase: `Running ${message.noiseRuns} noise comparisons` });
      noise = runNoiseComparison(message, result.metrics.netProfitPercent);
    }

    reply({ id: message.id, kind: "done", result, noise });
  } catch (error) {
    reply({ id: message.id, kind: "error", message: (error as Error).message });
  }
};

/**
 * Replays the strategy over random walks with no edge in them, and reports
 * where the real result falls in that distribution.
 */
function runNoiseComparison(message: RunMessage, realReturn: number): NoiseSummary {
  const startPrice = message.bars[0]?.close ?? 100;
  const barCount = message.bars.length;
  const returns: number[] = [];

  for (let i = 0; i < message.noiseRuns; i++) {
    const noiseBars = generateBars({
      bars: barCount,
      startPrice,
      volatility: message.noiseVolatility,
      drift: 0,
      seed: 90_000 + i,
      intervalMs: inferInterval(message.bars),
    });
    returns.push(runBacktest(noiseBars, message.strategy, message.config).metrics.netProfitPercent);
  }

  returns.sort((a, b) => a - b);
  const beaten = returns.filter(r => r < realReturn).length;

  return {
    runs: returns.length,
    mean: returns.reduce((a, b) => a + b, 0) / returns.length,
    median: returns[Math.floor(returns.length / 2)],
    best: returns[returns.length - 1],
    worst: returns[0],
    profitable: returns.filter(r => r > 0).length,
    percentile: beaten / returns.length,
  };
}

function inferInterval(bars: Bar[]): number {
  if (bars.length < 2) return 3_600_000;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(bars.length, 200); i++) gaps.push(bars[i].time - bars[i - 1].time);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 3_600_000;
}
