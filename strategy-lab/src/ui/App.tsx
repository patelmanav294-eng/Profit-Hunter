import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getInstrument } from "../data/instruments";
import type { BacktestConfig, BacktestResult } from "../engine/backtest";
import { strategyToPine } from "../export/pine";
import { collectWarnings } from "../report";
import { buildStrategy, DEFAULT_FORM, formFromStrategy, type StrategyForm } from "../strategies/build";
import { PRESETS } from "../strategies/presets";
import type { NoiseSummary, ResponseMessage, RunMessage } from "./backtest.worker";
import { DataPanel, type Dataset } from "./components/DataPanel";
import { EquityChart } from "./components/EquityChart";
import { MetricsGrid } from "./components/MetricsGrid";
import { PineDialog } from "./components/PineDialog";
import { StrategyPanel } from "./components/StrategyPanel";
import { TradeTable } from "./components/TradeTable";

interface Costs {
  balance: number;
  spreadPips: number;
  commission: number;
  slippagePips: number;
  optimistic: boolean;
  noiseRuns: number;
}

const DEFAULT_COSTS: Costs = {
  balance: 10_000,
  spreadPips: 1,
  commission: 0,
  slippagePips: 0,
  optimistic: false,
  noiseRuns: 25,
};

export function App() {
  const [form, setForm] = useState<StrategyForm>(DEFAULT_FORM);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [symbol, setSymbol] = useState("EURUSD");
  const [costs, setCosts] = useState<Costs>(DEFAULT_COSTS);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [noise, setNoise] = useState<NoiseSummary | undefined>();
  const [runError, setRunError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [pineScript, setPineScript] = useState<string | null>(null);

  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const instance = new Worker(new URL("./backtest.worker.ts", import.meta.url), { type: "module" });

    instance.onmessage = (event: MessageEvent<ResponseMessage>) => {
      const message = event.data;
      // Ignore replies from a run the user has already superseded.
      if (message.id !== requestId.current) return;

      if (message.kind === "progress") {
        setPhase(message.phase);
        return;
      }
      setPhase(null);
      if (message.kind === "error") {
        setRunError(message.message);
        setResult(null);
        setNoise(undefined);
        return;
      }
      setRunError(null);
      setResult(message.result);
      setNoise(message.noise);
    };

    instance.onerror = event => {
      setPhase(null);
      setRunError(event.message || "The backtest worker crashed");
    };

    worker.current = instance;
    return () => instance.terminate();
  }, []);

  const build = useMemo(() => buildStrategy(form), [form]);
  const issues = build.ok ? [] : build.issues;

  const patchForm = useCallback((patch: Partial<StrategyForm>) => {
    setForm(current => ({ ...current, ...patch }));
  }, []);

  const loadPreset = useCallback((name: string) => {
    const preset = PRESETS.find(p => p.name === name);
    if (preset) setForm(formFromStrategy(preset));
  }, []);

  const run = useCallback(() => {
    if (!dataset || !build.ok || !worker.current) return;

    const config: BacktestConfig = {
      instrument: getInstrument(symbol),
      costs: {
        spreadPips: costs.spreadPips,
        commissionPerLotPerSide: costs.commission,
        slippagePips: costs.slippagePips,
      },
      initialBalance: costs.balance,
      intrabarPriority: costs.optimistic ? "optimistic" : "pessimistic",
    };

    const id = ++requestId.current;
    setPhase("Starting");
    setRunError(null);

    const message: RunMessage = {
      id,
      kind: "run",
      bars: dataset.bars,
      strategy: build.strategy,
      config,
      noiseRuns: costs.noiseRuns,
      noiseVolatility: dataset.volatility,
    };
    worker.current.postMessage(message);
  }, [dataset, build, symbol, costs]);

  const exportStrategy = useCallback(() => {
    if (!build.ok) return;
    const blob = new Blob([JSON.stringify(build.strategy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${build.strategy.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [build]);

  const showPine = useCallback(() => {
    if (!build.ok) return;
    setPineScript(
      strategyToPine(build.strategy, {
        instrument: getInstrument(symbol),
        costs: {
          spreadPips: costs.spreadPips,
          commissionPerLotPerSide: costs.commission,
          slippagePips: costs.slippagePips,
        },
        initialCapital: costs.balance,
      }),
    );
  }, [build, symbol, costs]);

  const warnings = result ? collectWarnings(result) : [];
  const canRun = dataset !== null && build.ok && phase === null;

  return (
    <div className="app">
      {pineScript && <PineDialog script={pineScript} onClose={() => setPineScript(null)} />}

      <header className="topbar">
        <h1>Strategy Lab</h1>
        <span className="tagline">rules in, honest numbers out</span>
        <div className="spacer" />
        {phase && <span className="status">{phase}…</span>}
        <button className="ghost" onClick={showPine} disabled={!build.ok}>
          Pine Script
        </button>
        <button className="ghost" onClick={exportStrategy} disabled={!build.ok}>
          Export JSON
        </button>
        <button className="primary" onClick={run} disabled={!canRun}>
          Run backtest
        </button>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <DataPanel dataset={dataset} symbol={symbol} onSymbolChange={setSymbol} onLoad={setDataset} />

          <StrategyPanel
            form={form}
            issues={issues}
            onChange={patchForm}
            onLoadPreset={loadPreset}
            presetNames={PRESETS.map(p => p.name)}
          />

          <div className="panel">
            <h2 className="panel-title">Account &amp; costs</h2>
            <div className="row">
              <div className="field">
                <label htmlFor="balance">Starting balance</label>
                <input
                  id="balance"
                  type="number"
                  min="1"
                  value={costs.balance}
                  onChange={e => setCosts({ ...costs, balance: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="spread">Spread (pips)</label>
                <input
                  id="spread"
                  type="number"
                  min="0"
                  step="0.1"
                  value={costs.spreadPips}
                  onChange={e => setCosts({ ...costs, spreadPips: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="commission">Commission / lot / side</label>
                <input
                  id="commission"
                  type="number"
                  min="0"
                  step="0.5"
                  value={costs.commission}
                  onChange={e => setCosts({ ...costs, commission: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="slippage">Slippage (pips)</label>
                <input
                  id="slippage"
                  type="number"
                  min="0"
                  step="0.1"
                  value={costs.slippagePips}
                  onChange={e => setCosts({ ...costs, slippagePips: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="noise-runs">Noise comparison runs</label>
              <input
                id="noise-runs"
                type="number"
                min="0"
                max="200"
                step="5"
                value={costs.noiseRuns}
                onChange={e => setCosts({ ...costs, noiseRuns: Number(e.target.value) })}
              />
              <div className="hint">
                Replays the strategy over random walks with no edge in them, then reports where your result falls in
                that distribution. Set to 0 to skip.
              </div>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={costs.optimistic}
                onChange={e => setCosts({ ...costs, optimistic: e.target.checked })}
              />
              Assume the target filled first on ambiguous bars
            </label>
            <div className="hint" style={{ marginTop: -6 }}>
              Off by default. When one bar touches both stop and target, bar data cannot say which came first, so the
              engine assumes the stop.
            </div>
          </div>
        </aside>

        <main className="results">
          {runError && <div className="error-box">{runError}</div>}

          {!result && !runError && (
            <div className="empty">
              <strong>{dataset ? "Ready to run" : "Load some data to begin"}</strong>
              <span>
                {dataset
                  ? "Adjust the rules on the left, then hit Run backtest."
                  : "Import a CSV, generate random-walk bars, or fetch live history from the panel on the left."}
              </span>
            </div>
          )}

          {result && (
            <>
              <MetricsGrid result={result} noise={noise} />

              {warnings.length > 0 && (
                <div className="warnings">
                  <h3>Read this before believing the numbers</h3>
                  <ul>
                    {warnings.map(warning => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="panel">
                <h2 className="panel-title">Equity &amp; drawdown</h2>
                <EquityChart curve={result.equityCurve} initialBalance={result.config.initialBalance} />
              </div>

              {noise && (
                <div className="panel">
                  <h2 className="panel-title">Compared with data that has no edge</h2>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-dim)" }}>
                    Across {noise.runs} random walks matched to this data's volatility, the same strategy returned a
                    median of {noise.median.toFixed(2)}%, ranging from {noise.worst.toFixed(2)}% to{" "}
                    {noise.best.toFixed(2)}%, and finished in profit {noise.profitable} times. Your result sits at the{" "}
                    {(noise.percentile * 100).toFixed(0)}th percentile of that spread.
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-faint)" }}>
                    {noise.percentile >= 0.9
                      ? "That is outside most of what noise produces — worth investigating further, though it is still one sample."
                      : "That falls inside the range random data produces on its own, so this result is not yet evidence of an edge."}
                  </p>
                </div>
              )}

              <div className="panel">
                <h2 className="panel-title">Trades ({result.trades.length})</h2>
                <TradeTable trades={result.trades} digits={result.config.instrument.digits} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
