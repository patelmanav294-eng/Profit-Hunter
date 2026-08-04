import { useRef, useState } from "react";

import type { Timeframe } from "../../data/adapters";
import { parseCsv } from "../../data/csv";
import { INSTRUMENTS } from "../../data/instruments";
import { measureVolatility } from "../../data/statistics";
import { generateBars } from "../../data/synthetic";
import type { Bar } from "../../engine/types";

export interface Dataset {
  bars: Bar[];
  label: string;
  /** Which instrument spec to price the trades with. */
  symbol: string;
  /** Per-bar volatility, measured from the data, for the noise comparison. */
  volatility: number;
}

interface Props {
  dataset: Dataset | null;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  onLoad: (dataset: Dataset) => void;
}

const TIMEFRAMES: Timeframe[] = ["M5", "M15", "M30", "H1", "H4", "D1"];

export function DataPanel({ dataset, symbol, onSymbolChange, onLoad }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteSymbol, setRemoteSymbol] = useState("BTCUSDT");
  const [source, setSource] = useState<"binance" | "yahoo">("binance");
  const [timeframe, setTimeframe] = useState<Timeframe>("H1");
  const [syntheticBars, setSyntheticBars] = useState(5000);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setNotice(null);
    const text = await file.text();
    const parsed = parseCsv(text);

    if (parsed.bars.length === 0) {
      setError(parsed.errors[0]?.reason ?? "No usable rows in that file");
      return;
    }
    if (parsed.rejected > 0) {
      setNotice(`Skipped ${parsed.rejected} unusable rows — first problem: ${parsed.errors[0]?.reason}`);
    }
    onLoad({
      bars: parsed.bars,
      label: file.name,
      symbol,
      volatility: measureVolatility(parsed.bars),
    });
  };

  const loadSynthetic = () => {
    setError(null);
    setNotice(null);
    const startPrice = symbol.toUpperCase().includes("JPY") ? 150 : symbol.toUpperCase().includes("BTC") ? 60_000 : 1.1;
    const bars = generateBars({ bars: syntheticBars, startPrice, volatility: 0.002, seed: Date.now() % 100_000 });
    onLoad({ bars, label: `synthetic · ${syntheticBars} bars`, symbol, volatility: 0.002 });
    setNotice("Random-walk data with no edge in it. Use this to see what your strategy does on pure noise.");
  };

  const fetchRemote = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // Goes through the local proxy — neither provider sends CORS headers.
      const response = await fetch(
        `/api/bars?source=${source}&symbol=${encodeURIComponent(remoteSymbol)}&timeframe=${timeframe}&limit=5000`,
      );
      const payload = (await response.json()) as { bars?: Bar[]; error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }
      const bars = payload.bars ?? [];
      if (bars.length === 0) throw new Error("The provider returned no bars for that symbol");

      onLoad({
        bars,
        label: `${remoteSymbol} ${timeframe} · ${source}`,
        symbol,
        volatility: measureVolatility(bars),
      });
    } catch (caught) {
      setError(
        `${(caught as Error).message}. The proxy must be running — start it with "npm run proxy" in a second terminal.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">Data</h2>

      {dataset ? (
        <div className="status" style={{ marginBottom: 12 }}>
          {dataset.label}
          <br />
          {dataset.bars.length.toLocaleString()} bars ·{" "}
          {new Date(dataset.bars[0].time).toISOString().slice(0, 10)} →{" "}
          {new Date(dataset.bars[dataset.bars.length - 1].time).toISOString().slice(0, 10)}
        </div>
      ) : (
        <div className="status" style={{ marginBottom: 12 }}>
          No data loaded.
        </div>
      )}

      <div className="field">
        <label htmlFor="instrument">Instrument spec</label>
        <select id="instrument" value={symbol} onChange={event => onSymbolChange(event.target.value)}>
          {Object.keys(INSTRUMENTS).map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div className="hint">Sets pip size, contract size and lot limits — not which data is loaded.</div>
      </div>

      <div className="field">
        <label>Load a CSV</label>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv"
          style={{ display: "none" }}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Choose file…</button>
        <div className="hint">
          MetaTrader, TradingView and generic exports all work — the parser sniffs the delimiter, column order and
          date format.
        </div>
      </div>

      <div className="field">
        <label htmlFor="synthetic-bars">Or generate random-walk bars</label>
        <div className="row">
          <input
            id="synthetic-bars"
            type="number"
            min="100"
            step="500"
            value={syntheticBars}
            onChange={event => setSyntheticBars(Math.max(100, Number(event.target.value)))}
          />
          <button onClick={loadSynthetic}>Generate</button>
        </div>
      </div>

      <div className="field">
        <label>Or fetch live history</label>
        <div className="row">
          <select value={source} onChange={event => setSource(event.target.value as "binance" | "yahoo")}>
            <option value="binance">Binance</option>
            <option value="yahoo">Yahoo</option>
          </select>
          <select value={timeframe} onChange={event => setTimeframe(event.target.value as Timeframe)}>
            {TIMEFRAMES.map(tf => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            type="text"
            value={remoteSymbol}
            spellCheck={false}
            onChange={event => setRemoteSymbol(event.target.value)}
          />
          <button onClick={() => void fetchRemote()} disabled={busy}>
            {busy ? "Fetching…" : "Fetch"}
          </button>
        </div>
        <div className="hint">
          {source === "binance"
            ? "Exchange symbols, e.g. BTCUSDT, ETHUSDT"
            : "Yahoo tickers — FX pairs end in =X, e.g. EURUSD=X"}
        </div>
      </div>

      {notice && <div className="status">{notice}</div>}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
