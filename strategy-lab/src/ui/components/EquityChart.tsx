import { useMemo } from "react";

import type { EquityPoint } from "../../engine/types";
import { formatMoney } from "../../report";

interface Props {
  curve: EquityPoint[];
  initialBalance: number;
}

const WIDTH = 900;
const EQUITY_HEIGHT = 240;
const DRAWDOWN_HEIGHT = 70;
const GAP = 26;
const PADDING = { top: 12, right: 16, bottom: 22, left: 62 };

/**
 * Equity curve with a drawdown band beneath it.
 *
 * Drawn as raw SVG rather than through a charting library: the curve has one
 * point per bar, which is routinely tens of thousands, and most libraries mount
 * a DOM node per datum. Downsampling to the pixel width keeps it instant.
 */
export function EquityChart({ curve, initialBalance }: Props) {
  const geometry = useMemo(() => buildGeometry(curve, initialBalance), [curve, initialBalance]);

  if (!geometry) {
    return <div className="empty">Not enough data to draw a curve.</div>;
  }

  const { points, equityPath, drawdownPath, yTicks, xTicks, minEquity, maxEquity, maxDrawdown } = geometry;
  const totalHeight = EQUITY_HEIGHT + GAP + DRAWDOWN_HEIGHT;
  const finalEquity = points[points.length - 1].equity;
  const up = finalEquity >= initialBalance;

  return (
    <div className="chart">
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${WIDTH} ${totalHeight}`} role="img" aria-label="Equity curve and drawdown">
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={up ? "var(--positive)" : "var(--negative)"} stopOpacity="0.18" />
              <stop offset="100%" stopColor={up ? "var(--positive)" : "var(--negative)"} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Equity panel */}
          {yTicks.map(tick => (
            <g key={`y-${tick.value}`}>
              <line
                x1={PADDING.left}
                y1={tick.y}
                x2={WIDTH - PADDING.right}
                y2={tick.y}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <text x={PADDING.left - 8} y={tick.y + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
                {tick.label}
              </text>
            </g>
          ))}

          {/* The starting balance, so profit and loss are readable at a glance. */}
          <line
            x1={PADDING.left}
            y1={geometry.baselineY}
            x2={WIDTH - PADDING.right}
            y2={geometry.baselineY}
            stroke="var(--text-faint)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.6"
          />

          <path d={`${equityPath} L ${geometry.lastX} ${EQUITY_HEIGHT - PADDING.bottom} L ${PADDING.left} ${EQUITY_HEIGHT - PADDING.bottom} Z`} fill="url(#equityFill)" />
          <path
            d={equityPath}
            fill="none"
            stroke={up ? "var(--positive)" : "var(--negative)"}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />

          {/* Drawdown panel */}
          <text
            x={PADDING.left - 8}
            y={EQUITY_HEIGHT + GAP + 10}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-faint)"
          >
            0%
          </text>
          <text
            x={PADDING.left - 8}
            y={EQUITY_HEIGHT + GAP + DRAWDOWN_HEIGHT - PADDING.bottom + 4}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-faint)"
          >
            −{(maxDrawdown * 100).toFixed(1)}%
          </text>
          <line
            x1={PADDING.left}
            y1={EQUITY_HEIGHT + GAP + 6}
            x2={WIDTH - PADDING.right}
            y2={EQUITY_HEIGHT + GAP + 6}
            stroke="var(--border)"
          />
          <path d={drawdownPath} fill="var(--negative)" fillOpacity="0.35" stroke="none" />

          {xTicks.map(tick => (
            <text
              key={`x-${tick.x}`}
              x={tick.x}
              y={totalHeight - 6}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-faint)"
            >
              {tick.label}
            </text>
          ))}
        </svg>
      </div>

      <div className="chart-legend">
        <span>
          <i className="swatch" style={{ background: up ? "var(--positive)" : "var(--negative)" }} />
          Equity — {formatMoney(minEquity)} low, {formatMoney(maxEquity)} high
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--negative)", opacity: 0.5 }} />
          Drawdown from peak — {(maxDrawdown * 100).toFixed(1)}% worst
        </span>
        <span>{curve.length.toLocaleString()} bars</span>
      </div>
    </div>
  );
}

interface Geometry {
  points: EquityPoint[];
  equityPath: string;
  drawdownPath: string;
  baselineY: number;
  lastX: number;
  minEquity: number;
  maxEquity: number;
  maxDrawdown: number;
  yTicks: { value: number; y: number; label: string }[];
  xTicks: { x: number; label: string }[];
}

function buildGeometry(curve: EquityPoint[], initialBalance: number): Geometry | null {
  if (curve.length < 2) return null;

  const points = downsample(curve, WIDTH * 2);
  const equities = points.map(p => p.equity);
  let minEquity = Math.min(...equities, initialBalance);
  let maxEquity = Math.max(...equities, initialBalance);

  // A perfectly flat curve would collapse the scale to a single line.
  if (maxEquity - minEquity < 1e-9) {
    minEquity -= 1;
    maxEquity += 1;
  }
  const headroom = (maxEquity - minEquity) * 0.08;
  minEquity -= headroom;
  maxEquity += headroom;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = EQUITY_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index: number) => PADDING.left + (index / (points.length - 1)) * plotWidth;
  const yFor = (equity: number) =>
    PADDING.top + plotHeight - ((equity - minEquity) / (maxEquity - minEquity)) * plotHeight;

  const equityPath = points
    .map((point, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(point.equity).toFixed(2)}`)
    .join(" ");

  const maxDrawdown = Math.max(...points.map(p => p.drawdown), 0.0001);
  const ddTop = EQUITY_HEIGHT + GAP + 6;
  const ddPlotHeight = DRAWDOWN_HEIGHT - PADDING.bottom;
  const ddY = (drawdown: number) => ddTop + (drawdown / maxDrawdown) * ddPlotHeight;

  const drawdownPath = [
    `M ${PADDING.left} ${ddTop}`,
    ...points.map((point, i) => `L ${xFor(i).toFixed(2)} ${ddY(point.drawdown).toFixed(2)}`),
    `L ${xFor(points.length - 1).toFixed(2)} ${ddTop}`,
    "Z",
  ].join(" ");

  const yTicks = buildYTicks(minEquity, maxEquity, yFor);
  const xTicks = buildXTicks(points, xFor);

  return {
    points,
    equityPath,
    drawdownPath,
    baselineY: yFor(initialBalance),
    lastX: xFor(points.length - 1),
    minEquity: Math.min(...equities),
    maxEquity: Math.max(...equities),
    maxDrawdown,
    yTicks,
    xTicks,
  };
}

/** Keeps every extreme while thinning the curve to roughly `target` points. */
function downsample(curve: EquityPoint[], target: number): EquityPoint[] {
  if (curve.length <= target) return curve;

  const bucketSize = curve.length / target;
  const out: EquityPoint[] = [];

  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(Math.floor((i + 1) * bucketSize), curve.length);
    if (end <= start) continue;

    // Take the bucket's extreme so spikes and troughs survive the thinning —
    // averaging would quietly erase the drawdowns people most need to see.
    let extreme = curve[start];
    let widestDrawdown = curve[start];
    for (let j = start + 1; j < end; j++) {
      if (Math.abs(curve[j].equity - curve[start].equity) > Math.abs(extreme.equity - curve[start].equity)) {
        extreme = curve[j];
      }
      if (curve[j].drawdown > widestDrawdown.drawdown) widestDrawdown = curve[j];
    }
    out.push({ ...extreme, drawdown: Math.max(extreme.drawdown, widestDrawdown.drawdown) });
  }

  // Always anchor the ends so the curve starts and finishes at the true values.
  out[0] = curve[0];
  out[out.length - 1] = curve[curve.length - 1];
  return out;
}

function buildYTicks(min: number, max: number, yFor: (v: number) => number) {
  const ticks: { value: number; y: number; label: string }[] = [];
  const count = 4;
  for (let i = 0; i <= count; i++) {
    const value = min + ((max - min) * i) / count;
    ticks.push({ value, y: yFor(value), label: compactMoney(value) });
  }
  return ticks;
}

function buildXTicks(points: EquityPoint[], xFor: (i: number) => number) {
  const ticks: { x: number; label: string }[] = [];
  const count = Math.min(6, points.length - 1);
  for (let i = 0; i <= count; i++) {
    const index = Math.round((i / count) * (points.length - 1));
    ticks.push({
      x: xFor(index),
      label: new Date(points[index].time).toISOString().slice(0, 10),
    });
  }
  return ticks;
}

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}
