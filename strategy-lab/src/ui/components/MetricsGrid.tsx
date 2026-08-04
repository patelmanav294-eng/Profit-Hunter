import type { BacktestResult } from "../../engine/backtest";
import { formatMoney, formatPercent, formatRatio } from "../../report";
import type { NoiseSummary } from "../backtest.worker";

interface Props {
  result: BacktestResult;
  noise?: NoiseSummary;
}

export function MetricsGrid({ result, noise }: Props) {
  const m = result.metrics;
  const sign = (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "");

  return (
    <div className="metric-grid">
      <Metric
        label="Net profit"
        value={formatMoney(m.netProfit)}
        sub={formatPercent(m.netProfitPercent)}
        tone={sign(m.netProfit)}
      />
      <Metric
        label="Max drawdown"
        value={formatPercent(m.maxDrawdownPercent)}
        sub={`${formatMoney(m.maxDrawdown)} · ${m.maxDrawdownBars} bars`}
        tone={m.maxDrawdownPercent > 25 ? "negative" : ""}
      />
      <Metric label="Trades" value={String(m.totalTrades)} sub={`${m.wins}W / ${m.losses}L / ${m.breakEven}BE`} />
      <Metric
        label="Win rate"
        value={formatPercent(m.winRate * 100, 1)}
        sub={`payoff ${formatRatio(m.payoffRatio)}`}
      />
      <Metric
        label="Profit factor"
        value={formatRatio(m.profitFactor)}
        sub="gross win ÷ gross loss"
        tone={m.profitFactor >= 1 ? "positive" : "negative"}
      />
      <Metric
        label="Expectancy"
        value={m.expectancyR !== undefined ? `${m.expectancyR >= 0 ? "+" : ""}${m.expectancyR.toFixed(3)}R` : formatMoney(m.expectancy)}
        sub={m.expectancyR !== undefined ? `${formatMoney(m.expectancy)} per trade` : "per trade"}
        tone={sign(m.expectancy)}
      />
      <Metric label="Sharpe" value={formatRatio(m.sharpe)} sub={`sortino ${formatRatio(m.sortino)}`} />
      <Metric label="CAGR" value={formatPercent(m.cagr * 100, 1)} sub={`${m.periodDays.toFixed(0)} days`} tone={sign(m.cagr)} />
      <Metric
        label="Exposure"
        value={formatPercent(m.exposure * 100, 1)}
        sub={`${m.avgBarsHeld.toFixed(1)} bars avg hold`}
      />
      <Metric
        label="Streaks"
        value={`${m.longestWinStreak}W / ${m.longestLossStreak}L`}
        sub={`largest loss ${formatMoney(m.largestLoss)}`}
      />

      {noise && (
        <Metric
          label="vs random data"
          value={`${(noise.percentile * 100).toFixed(0)}th pct`}
          sub={`beat ${Math.round(noise.percentile * noise.runs)} of ${noise.runs} noise runs`}
          // Below the 90th percentile the result is inside the range that data
          // with no edge produces, which is not evidence of anything.
          tone={noise.percentile >= 0.9 ? "positive" : "negative"}
        />
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
