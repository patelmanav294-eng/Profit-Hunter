/**
 * CSV → `Bar[]`.
 *
 * Handles the formats people actually have lying around: MetaTrader exports,
 * TradingView downloads, Dukascopy, and generic epoch-timestamped dumps. The
 * parser sniffs the delimiter, the column order and the date format rather than
 * demanding one canonical layout.
 */

import type { Bar } from "../engine/types";

export interface ParseError {
  line: number;
  reason: string;
  /** The offending row, truncated — seeing it is usually the whole diagnosis. */
  content?: string;
}

export interface ParseResult {
  bars: Bar[];
  /** Rows that could not be parsed, with the reason. Capped to keep the UI usable. */
  errors: ParseError[];
  /** Total rows rejected, including any beyond the reported `errors`. */
  rejected: number;
  /**
   * Set when nothing parsed, explaining what the file looked like instead.
   * "Non-numeric OHLC value" on its own sends people hunting through their data
   * for a bad row when the real answer is often that the file is not price data
   * at all.
   */
  diagnosis?: string;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  time: ["time", "date", "datetime", "timestamp", "date_time", "open_time", "local time", "gmt time"],
  open: ["open", "o", "<open>"],
  high: ["high", "h", "<high>"],
  low: ["low", "l", "<low>"],
  close: ["close", "c", "<close>", "price"],
  volume: ["volume", "vol", "v", "<vol>", "tickvol", "<tickvol>"],
};

export function parseCsv(text: string, maxReportedErrors = 20): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return { bars: [], errors: [{ line: 0, reason: "File is empty" }], rejected: 0 };
  }

  const delimiter = sniffDelimiter(lines[0]);
  const firstRow = splitRow(lines[0], delimiter);
  const mapping = mapColumns(firstRow);
  const hasHeader = mapping !== null;
  const columns = mapping ?? defaultColumnOrder(splitRow(lines[0], delimiter).length);

  const bars: Bar[] = [];
  const errors: ParseError[] = [];
  let rejected = 0;

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cells = splitRow(lines[i], delimiter);
    const bar = rowToBar(cells, columns);

    if (typeof bar === "string") {
      rejected++;
      if (errors.length < maxReportedErrors) {
        errors.push({ line: i + 1, reason: bar, content: truncate(lines[i], 120) });
      }
      continue;
    }
    bars.push(bar);
  }

  // Sort defensively — some exports are newest-first — then drop duplicate
  // timestamps, which the engine rejects outright.
  bars.sort((a, b) => a.time - b.time);
  const deduped: Bar[] = [];
  for (const bar of bars) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === bar.time) {
      rejected++;
      continue;
    }
    deduped.push(bar);
  }

  return { bars: deduped, errors, rejected, diagnosis: diagnose(deduped, lines, firstRow, hasHeader) };
}

/**
 * Explains an empty result in terms of what the file actually contains.
 *
 * The common failure is not a malformed price file — it is a file that was
 * never price data to begin with, and naming the columns it does have makes
 * that obvious at a glance.
 */
function diagnose(bars: Bar[], lines: string[], firstRow: string[], hasHeader: boolean): string | undefined {
  if (bars.length > 0) return undefined;

  if (hasHeader) {
    return `Found OHLC column names but no row parsed cleanly. First data row: "${truncate(lines[1] ?? "", 120)}"`;
  }

  return (
    `This file does not look like OHLC price data. No column named time, open, high, low or close was found — ` +
    `the first line reads "${truncate(lines[0] ?? "", 120)}"` +
    (firstRow.length > 1 ? `, which parses as ${firstRow.length} columns: ${firstRow.slice(0, 8).join(", ")}` : "") +
    ". A usable file needs a header naming those columns, or the values in time,open,high,low,close order."
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface ColumnMap {
  time: number;
  /** Some exports split date and time into separate columns. */
  timePart?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function mapColumns(header: string[]): ColumnMap | null {
  const normalised = header.map(h => h.toLowerCase().replace(/^["']|["']$/g, "").trim());
  const find = (key: string): number =>
    normalised.findIndex(h => COLUMN_ALIASES[key].some(alias => h === alias || h === `<${alias}>`));

  const time = find("time");
  const open = find("open");
  const high = find("high");
  const low = find("low");
  const close = find("close");
  if (time === -1 || open === -1 || high === -1 || low === -1 || close === -1) return null;

  const volume = find("volume");
  const map: ColumnMap = { time, open, high, low, close };
  if (volume !== -1) map.volume = volume;

  // MetaTrader writes "<DATE>","<TIME>" as adjacent columns.
  const timePartIndex = normalised.findIndex(h => h === "time" || h === "<time>");
  if (timePartIndex !== -1 && timePartIndex !== time) map.timePart = timePartIndex;

  return map;
}

function defaultColumnOrder(columnCount: number): ColumnMap {
  // Headerless files are assumed to be time,O,H,L,C[,V] — the near-universal order.
  const map: ColumnMap = { time: 0, open: 1, high: 2, low: 3, close: 4 };
  if (columnCount >= 6) map.volume = 5;
  return map;
}

function rowToBar(cells: string[], columns: ColumnMap): Bar | string {
  const needed = Math.max(columns.time, columns.open, columns.high, columns.low, columns.close);
  if (cells.length <= needed) return `Expected at least ${needed + 1} columns, found ${cells.length}`;

  const rawTime =
    columns.timePart !== undefined ? `${cells[columns.time]} ${cells[columns.timePart]}` : cells[columns.time];
  const time = parseTimestamp(rawTime);
  if (time === null) return `Could not read a date from "${rawTime}"`;

  const open = parseNumber(cells[columns.open]);
  const high = parseNumber(cells[columns.high]);
  const low = parseNumber(cells[columns.low]);
  const close = parseNumber(cells[columns.close]);
  if (open === null || high === null || low === null || close === null) {
    return "Non-numeric OHLC value";
  }

  // A bar whose high is below its low (or outside its own open/close) is corrupt
  // and would produce nonsense fills, so it is dropped rather than repaired.
  if (high < low) return `High (${high}) is below low (${low})`;
  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    return "High/low do not contain open/close";
  }

  const bar: Bar = { time, open, high, low, close };
  if (columns.volume !== undefined) {
    const volume = parseNumber(cells[columns.volume]);
    if (volume !== null) bar.volume = volume;
  }
  return bar;
}

function sniffDelimiter(line: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

function splitRow(line: string, delimiter: string): string[] {
  return line.split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, ""));
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  // Tolerate thousands separators; reject anything else non-numeric.
  const value = Number(raw.replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function parseTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Bare digits are epoch seconds, milliseconds, or microseconds.
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (trimmed.length <= 10) return value * 1000;
    if (trimmed.length <= 13) return value;
    return Math.floor(value / 1000);
  }

  // MetaTrader's "2024.01.15 09:30" / "2024.01.15" use dots between date parts.
  const mt = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mt) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = mt;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  }

  // "2024-01-15 09:30:00" without a zone — treat as UTC rather than letting the
  // host timezone silently shift every bar.
  const spaceSeparated = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (spaceSeparated) {
    const [, y, mo, d, h, mi, s = "0"] = spaceSeparated;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  }

  // Date-only ISO parses as UTC midnight per spec, which is what we want.
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds the message shown when a file yields no bars: what the parser saw,
 * the first few offending rows verbatim, and the command that downloads real
 * data instead.
 */
export function describeParseFailure(result: ParseResult, path: string): string {
  const lines = [`Could not read any price bars from ${path}`, ""];

  if (result.diagnosis) lines.push(`  ${result.diagnosis}`, "");

  if (result.errors.length > 0) {
    lines.push("  First rows that failed:");
    for (const error of result.errors.slice(0, 3)) {
      lines.push(`    line ${error.line}  ${error.reason}`);
      if (error.content) lines.push(`      ${error.content}`);
    }
    lines.push("");
  }

  lines.push("  To download real data instead:");
  lines.push('    npm run fetch -- --symbol "XAUUSD=X" --timeframe H1 --out XAUUSD_H1.csv');

  return lines.join("\n");
}

/** Serialises bars back to CSV, for exporting a cleaned or fetched dataset. */
export function toCsv(bars: Bar[]): string {
  const rows = bars.map(
    b =>
      `${new Date(b.time).toISOString()},${b.open},${b.high},${b.low},${b.close},${b.volume ?? 0}`,
  );
  return ["time,open,high,low,close,volume", ...rows].join("\n");
}
