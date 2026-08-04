import { useState } from "react";

interface Props {
  script: string;
  onClose: () => void;
}

/**
 * Shows the generated Pine script with a copy button.
 *
 * The script is displayed rather than downloaded because TradingView's Pine
 * editor takes a paste, not a file — and seeing the code is the point: it is
 * the thing that gets checked against a real chart.
 */
export function PineDialog({ script, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be denied outright;
      // selecting the text by hand still works, so this is not worth an error.
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "strategy.pine";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={event => event.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2>TradingView Pine Script</h2>
            <p>
              Paste into Pine Editor, then <b>Add to chart</b>. Set the chart to the same symbol and timeframe you
              backtested, or the numbers will not line up.
            </p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <pre className="pine-code">
          <code>{script}</code>
        </pre>

        <div className="button-row">
          <button className="primary" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
          <button onClick={download}>Download .pine</button>
          <span className="status" style={{ alignSelf: "center" }}>
            {script.split("\n").length} lines
          </span>
        </div>
      </div>
    </div>
  );
}
