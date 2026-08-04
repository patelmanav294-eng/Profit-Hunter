import { useMemo, useState } from "react";

import type { Trade } from "../../engine/types";
import { formatDate, formatMoney } from "../../report";

interface Props {
  trades: Trade[];
  digits: number;
}

type SortKey = "id" | "direction" | "entryTime" | "netProfit" | "rMultiple" | "barsHeld" | "exitReason";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "id", label: "#" },
  { key: "direction", label: "Side" },
  { key: "entryTime", label: "Entry" },
  { key: "exitReason", label: "Exit" },
  { key: "barsHeld", label: "Bars", numeric: true },
  { key: "rMultiple", label: "R", numeric: true },
  { key: "netProfit", label: "Net", numeric: true },
];

const PAGE_SIZE = 100;

export function TradeTable({ trades, digits }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [ascending, setAscending] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const sorted = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      // Trades without a stop have no R multiple; sort those to the end
      // regardless of direction rather than letting undefined compare randomly.
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      const comparison = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
      return ascending ? comparison : -comparison;
    });
    return copy;
  }, [trades, sortKey, ascending]);

  if (trades.length === 0) {
    return (
      <div className="empty">
        <strong>No trades</strong>
        <span>The entry rules never fired on this data. Try loosening them or using a longer history.</span>
      </div>
    );
  }

  const toggle = (key: SortKey) => {
    if (key === sortKey) {
      setAscending(!ascending);
      return;
    }
    setSortKey(key);
    setAscending(true);
  };

  const visible = sorted.slice(0, limit);

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map(column => (
                <th
                  key={column.key}
                  className={column.numeric ? "num" : undefined}
                  onClick={() => toggle(column.key)}
                >
                  {column.label}
                  {sortKey === column.key ? (ascending ? " ↑" : " ↓") : ""}
                </th>
              ))}
              <th className="num">Entry px</th>
              <th className="num">Exit px</th>
              <th className="num">Lots</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(trade => (
              <tr key={trade.id}>
                <td>{trade.id}</td>
                <td>
                  <span className="tag">{trade.direction}</span>
                </td>
                <td>{formatDate(trade.entryTime)}</td>
                <td>{trade.exitReason}</td>
                <td className="num">{trade.barsHeld}</td>
                <td className={`num ${toneFor(trade.rMultiple)}`}>
                  {trade.rMultiple === undefined ? "—" : `${trade.rMultiple >= 0 ? "+" : ""}${trade.rMultiple.toFixed(2)}`}
                </td>
                <td className={`num ${toneFor(trade.netProfit)}`}>{formatMoney(trade.netProfit)}</td>
                <td className="num">{trade.entryPrice.toFixed(digits)}</td>
                <td className="num">{trade.exitPrice.toFixed(digits)}</td>
                <td className="num">{trade.lots.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limit < sorted.length && (
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={() => setLimit(limit + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, sorted.length - limit)} more of {sorted.length}
          </button>
          <button className="ghost" onClick={() => setLimit(sorted.length)}>
            Show all
          </button>
        </div>
      )}
    </>
  );
}

function toneFor(value: number | undefined): string {
  if (value === undefined) return "";
  return value > 0 ? "positive" : value < 0 ? "negative" : "";
}
