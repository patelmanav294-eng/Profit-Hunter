import type { BuildIssue, StopMode, StrategyForm, TargetMode } from "../../strategies/build";

interface Props {
  form: StrategyForm;
  issues: BuildIssue[];
  onChange: (patch: Partial<StrategyForm>) => void;
  onLoadPreset: (name: string) => void;
  presetNames: string[];
}

const STOP_MODES: { value: StopMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "atr", label: "ATR ×" },
  { value: "pips", label: "Pips" },
  { value: "percent", label: "% of price" },
];

const TARGET_MODES: { value: TargetMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "riskReward", label: "R multiple" },
  { value: "atr", label: "ATR ×" },
  { value: "pips", label: "Pips" },
  { value: "percent", label: "% of price" },
];

export function StrategyPanel({ form, issues, onChange, onLoadPreset, presetNames }: Props) {
  const errorFor = (field: string) => issues.find(issue => issue.field === field);

  const RuleField = ({
    field,
    label,
    hint,
  }: {
    field: keyof StrategyForm & string;
    label: string;
    hint?: string;
  }) => {
    const error = errorFor(field);
    return (
      <div className={`field ${error ? "invalid" : ""}`}>
        <label htmlFor={field}>{label}</label>
        <textarea
          id={field}
          rows={2}
          value={String(form[field] ?? "")}
          spellCheck={false}
          placeholder="leave blank to skip"
          onChange={event => onChange({ [field]: event.target.value } as Partial<StrategyForm>)}
        />
        {error ? <div className="field-error">{error.message}</div> : hint ? <div className="hint">{hint}</div> : null}
      </div>
    );
  };

  return (
    <div className="panel">
      <h2 className="panel-title">Strategy</h2>

      <div className="field">
        <label htmlFor="strategy-name">Name</label>
        <input
          id="strategy-name"
          type="text"
          value={form.name}
          onChange={event => onChange({ name: event.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="preset">Start from a preset</label>
        <select id="preset" value="" onChange={event => event.target.value && onLoadPreset(event.target.value)}>
          <option value="">Choose…</option>
          {presetNames.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <RuleField field="longEntry" label="Long entry" hint="e.g. ema 20 crosses above ema 50 and rsi 14 > 50" />
      <RuleField field="longExit" label="Long exit (optional)" hint="Stops and targets still apply if this is blank" />
      <RuleField field="shortEntry" label="Short entry" hint="Blank means long-only" />
      <RuleField field="shortExit" label="Short exit (optional)" />

      <details className="syntax-help">
        <summary style={{ cursor: "pointer", marginBottom: 6 }}>Rule syntax</summary>
        <div>
          <b>Values</b> close, open, high, low, or a number
          <br />
          <b>Indicators</b> ema 50, sma 20, rsi 14, atr 14, adx 14, macd, macd signal, macd hist, bb upper, bb
          lower, bb middle, stoch k, stoch d, highest 20, lowest 20
          <br />
          <b>Comparisons</b> &gt; &lt; &gt;= &lt;=, above, below, crosses above, crosses below
          <br />
          <b>Combining</b> and, or, not, parentheses
          <br />
          <b>Periods</b> optional where a convention exists (rsi = 14, macd = 12/26/9, bb = 20/2)
        </div>
      </details>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        Risk
      </h2>

      <div className="row">
        <div className="field">
          <label htmlFor="stop-mode">Stop loss</label>
          <select
            id="stop-mode"
            value={form.stopMode}
            onChange={event => onChange({ stopMode: event.target.value as StopMode })}
          >
            {STOP_MODES.map(mode => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className={`field ${errorFor("stopValue") ? "invalid" : ""}`}>
          <label htmlFor="stop-value">Distance</label>
          <input
            id="stop-value"
            type="number"
            step="0.1"
            min="0"
            disabled={form.stopMode === "none"}
            value={form.stopValue}
            onChange={event => onChange({ stopValue: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="target-mode">Take profit</label>
          <select
            id="target-mode"
            value={form.targetMode}
            onChange={event => onChange({ targetMode: event.target.value as TargetMode })}
          >
            {TARGET_MODES.map(mode => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className={`field ${errorFor("targetValue") ? "invalid" : ""}`}>
          <label htmlFor="target-value">Distance</label>
          <input
            id="target-value"
            type="number"
            step="0.1"
            min="0"
            disabled={form.targetMode === "none"}
            value={form.targetValue}
            onChange={event => onChange({ targetValue: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="trail-mode">Trailing stop</label>
          <select
            id="trail-mode"
            value={form.trailMode}
            onChange={event => onChange({ trailMode: event.target.value as StopMode })}
          >
            {STOP_MODES.filter(mode => mode.value !== "percent").map(mode => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="trail-value">Distance</label>
          <input
            id="trail-value"
            type="number"
            step="0.1"
            min="0"
            disabled={form.trailMode === "none"}
            value={form.trailValue}
            onChange={event => onChange({ trailValue: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="atr-period">ATR period</label>
          <input
            id="atr-period"
            type="number"
            min="1"
            step="1"
            value={form.atrPeriod}
            onChange={event => onChange({ atrPeriod: Math.max(1, Math.round(Number(event.target.value))) })}
          />
          <div className="hint">Used by ATR-based stops and targets</div>
        </div>
        <div className="field">
          <label htmlFor="max-bars">Time stop (bars)</label>
          <input
            id="max-bars"
            type="number"
            min="1"
            step="1"
            placeholder="off"
            value={form.maxBarsInTrade ?? ""}
            onChange={event =>
              onChange({ maxBarsInTrade: event.target.value === "" ? null : Number(event.target.value) })
            }
          />
        </div>
      </div>

      <h2 className="panel-title" style={{ marginTop: 18 }}>
        Sizing
      </h2>

      <div className="row">
        <div className="field">
          <label htmlFor="sizing-mode">Method</label>
          <select
            id="sizing-mode"
            value={form.sizingMode}
            onChange={event => onChange({ sizingMode: event.target.value as StrategyForm["sizingMode"] })}
          >
            <option value="riskPercent">Risk % of equity</option>
            <option value="fixedLot">Fixed lots</option>
          </select>
        </div>
        <div className={`field ${errorFor("sizingValue") ? "invalid" : ""}`}>
          <label htmlFor="sizing-value">{form.sizingMode === "riskPercent" ? "Percent" : "Lots"}</label>
          <input
            id="sizing-value"
            type="number"
            step="0.01"
            min="0"
            value={form.sizingValue}
            onChange={event => onChange({ sizingValue: Number(event.target.value) })}
          />
        </div>
      </div>
      {errorFor("sizingValue") && <div className="field-error">{errorFor("sizingValue")!.message}</div>}

      <div className="field">
        <label htmlFor="cooldown">Cooldown after a trade (bars)</label>
        <input
          id="cooldown"
          type="number"
          min="0"
          step="1"
          placeholder="off"
          value={form.cooldownBars ?? ""}
          onChange={event => onChange({ cooldownBars: event.target.value === "" ? null : Number(event.target.value) })}
        />
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.sessionEnabled}
          onChange={event => onChange({ sessionEnabled: event.target.checked })}
        />
        Only enter during a session window (UTC)
      </label>

      {form.sessionEnabled && (
        <div className="row">
          <div className="field">
            <label htmlFor="session-start">From hour</label>
            <input
              id="session-start"
              type="number"
              min="0"
              max="23"
              value={form.sessionStart}
              onChange={event => onChange({ sessionStart: Number(event.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="session-end">To hour</label>
            <input
              id="session-end"
              type="number"
              min="0"
              max="23"
              value={form.sessionEnd}
              onChange={event => onChange({ sessionEnd: Number(event.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
