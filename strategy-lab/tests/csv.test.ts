import { describe, expect, it } from "vitest";

import { describeParseFailure, parseCsv, parseTimestamp, toCsv } from "../src/data/csv";
import { aggregate } from "../src/data/adapters/yahoo";
import { dropUnclosedBar } from "../src/data/adapters";

describe("parseCsv", () => {
  it("reads a standard header row", () => {
    const result = parseCsv(
      ["time,open,high,low,close,volume", "2024-01-01T00:00:00Z,1.1,1.2,1.0,1.15,500"].join("\n"),
    );

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toEqual({
      time: Date.UTC(2024, 0, 1),
      open: 1.1,
      high: 1.2,
      low: 1.0,
      close: 1.15,
      volume: 500,
    });
  });

  it("accepts MetaTrader exports with dotted dates and angle-bracket headers", () => {
    const result = parseCsv(
      ["<DATE>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<TICKVOL>", "2024.03.15,1.0850,1.0900,1.0820,1.0875,1200"].join("\n"),
    );

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].time).toBe(Date.UTC(2024, 2, 15));
    expect(result.bars[0].close).toBe(1.0875);
  });

  it("falls back to time,O,H,L,C order when there is no header", () => {
    const result = parseCsv(["1704067200,1.1,1.2,1.0,1.15", "1704070800,1.15,1.25,1.14,1.2"].join("\n"));

    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].time).toBe(1704067200000);
    expect(result.bars[1].open).toBe(1.15);
  });

  it("detects semicolon and tab delimiters", () => {
    const semi = parseCsv(["time;open;high;low;close", "2024-01-01;1;2;0.5;1.5"].join("\n"));
    expect(semi.bars).toHaveLength(1);

    const tabbed = parseCsv(["time\topen\thigh\tlow\tclose", "2024-01-01\t1\t2\t0.5\t1.5"].join("\n"));
    expect(tabbed.bars).toHaveLength(1);
  });

  it("sorts newest-first exports into ascending order", () => {
    const result = parseCsv(
      [
        "time,open,high,low,close",
        "2024-01-03,3,3,3,3",
        "2024-01-01,1,1,1,1",
        "2024-01-02,2,2,2,2",
      ].join("\n"),
    );

    expect(result.bars.map(b => b.close)).toEqual([1, 2, 3]);
  });

  it("drops duplicate timestamps, which the engine would reject", () => {
    const result = parseCsv(
      ["time,open,high,low,close", "2024-01-01,1,1,1,1", "2024-01-01,2,2,2,2"].join("\n"),
    );

    expect(result.bars).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it("rejects a bar whose high is below its low", () => {
    const result = parseCsv(["time,open,high,low,close", "2024-01-01,1.1,1.0,1.2,1.15"].join("\n"));

    expect(result.bars).toHaveLength(0);
    expect(result.errors[0].reason).toMatch(/below low/);
  });

  it("rejects a bar whose range does not contain its open and close", () => {
    const result = parseCsv(["time,open,high,low,close", "2024-01-01,1.5,1.2,1.0,1.1"].join("\n"));

    expect(result.bars).toHaveLength(0);
    expect(result.errors[0].reason).toMatch(/do not contain/);
  });

  it("reports the line number of an unparseable row and keeps the good ones", () => {
    const result = parseCsv(
      ["time,open,high,low,close", "2024-01-01,1,1,1,1", "not-a-date,2,2,2,2", "2024-01-02,3,3,3,3"].join("\n"),
    );

    expect(result.bars).toHaveLength(2);
    expect(result.rejected).toBe(1);
    expect(result.errors[0].line).toBe(3);
  });

  it("caps how many errors it reports but still counts them all", () => {
    const rows = ["time,open,high,low,close", ...Array.from({ length: 50 }, () => "bad,1,1,1,1")];
    const result = parseCsv(rows.join("\n"), 5);

    expect(result.errors).toHaveLength(5);
    expect(result.rejected).toBe(50);
  });

  it("handles an empty file without throwing", () => {
    const result = parseCsv("");
    expect(result.bars).toHaveLength(0);
    expect(result.errors[0].reason).toMatch(/empty/);
  });

  it("round-trips through toCsv", () => {
    const original = parseCsv(
      ["time,open,high,low,close,volume", "2024-01-01T00:00:00Z,1.1,1.2,1.0,1.15,500"].join("\n"),
    );
    const reparsed = parseCsv(toCsv(original.bars));
    expect(reparsed.bars).toEqual(original.bars);
  });
});

describe("diagnosing a file that is not price data at all", () => {
  /**
   * Taken from a real mix-up: a spreadsheet renamed to look like an FX export.
   * "Non-numeric OHLC value" on its own sent the user hunting for a bad row,
   * when the answer was that no row was ever price data.
   */
  const attendance = [
    "OFFICE ATTENDANCE - JUNE 2026,,,,,",
    ",,,,,",
    "Date,Day,Time In,Time Out,Total Hours,Status",
    "01-Jun-26,Monday,09:00,17:30,8:30,Complete",
    "02-Jun-26,Tuesday,09:00,,,In Progress",
  ].join("\n");

  const result = parseCsv(attendance);

  it("produces no bars", () => {
    expect(result.bars).toHaveLength(0);
  });

  it("says the file is not price data rather than blaming one row", () => {
    expect(result.diagnosis).toBeDefined();
    expect(result.diagnosis).toMatch(/does not look like OHLC price data/);
  });

  it("quotes the header it actually found", () => {
    expect(result.diagnosis).toContain("OFFICE ATTENDANCE");
  });

  it("names the columns it parsed, so the mismatch is visible", () => {
    expect(result.diagnosis).toMatch(/parses as 6 columns/);
  });

  it("attaches the offending row to each error", () => {
    expect(result.errors[0].content).toContain("OFFICE ATTENDANCE");
    expect(result.errors[2].content).toContain("Time In");
  });

  it("builds a failure message that points at the fix", () => {
    const message = describeParseFailure(result, "./XAUUSD_H1.csv");
    expect(message).toContain("./XAUUSD_H1.csv");
    expect(message).toMatch(/does not look like OHLC price data/);
    expect(message).toContain("npm run fetch");
  });
});

describe("diagnosing a file with the right columns but bad values", () => {
  const result = parseCsv(["time,open,high,low,close", "2024-01-01,abc,def,ghi,jkl"].join("\n"));

  it("distinguishes this from a wholly wrong file", () => {
    expect(result.bars).toHaveLength(0);
    expect(result.diagnosis).toMatch(/Found OHLC column names but no row parsed/);
    expect(result.diagnosis).not.toMatch(/does not look like OHLC price data/);
  });

  it("shows the first data row verbatim", () => {
    expect(result.diagnosis).toContain("2024-01-01,abc");
  });
});

describe("a healthy file has nothing to diagnose", () => {
  it("leaves diagnosis unset", () => {
    const result = parseCsv(["time,open,high,low,close", "2024-01-01,1.1,1.2,1.0,1.15"].join("\n"));
    expect(result.bars).toHaveLength(1);
    expect(result.diagnosis).toBeUndefined();
  });
});

describe("parseTimestamp", () => {
  it("reads epoch seconds, milliseconds and microseconds", () => {
    expect(parseTimestamp("1704067200")).toBe(1704067200000);
    expect(parseTimestamp("1704067200000")).toBe(1704067200000);
    expect(parseTimestamp("1704067200000000")).toBe(1704067200000);
  });

  it("treats a zone-less datetime as UTC rather than local time", () => {
    // Without this the parsed bar shifts by the host machine's offset, which
    // silently moves every session filter.
    expect(parseTimestamp("2024-01-01 12:30:00")).toBe(Date.UTC(2024, 0, 1, 12, 30));
    expect(parseTimestamp("2024.01.01 12:30")).toBe(Date.UTC(2024, 0, 1, 12, 30));
  });

  it("returns null for something that is not a date", () => {
    expect(parseTimestamp("hello")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

describe("aggregate", () => {
  const hourly = Array.from({ length: 9 }, (_, i) => ({
    time: Date.UTC(2024, 0, 1, i),
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));

  it("merges bars into higher timeframes using first-open, last-close", () => {
    const fourHour = aggregate(hourly, 4);

    expect(fourHour).toHaveLength(2);
    expect(fourHour[0].time).toBe(hourly[0].time);
    expect(fourHour[0].open).toBe(hourly[0].open);
    expect(fourHour[0].close).toBe(hourly[3].close);
    expect(fourHour[0].high).toBe(Math.max(...hourly.slice(0, 4).map(b => b.high)));
    expect(fourHour[0].low).toBe(Math.min(...hourly.slice(0, 4).map(b => b.low)));
  });

  it("discards a trailing partial group", () => {
    // 9 hourly bars make two complete 4h candles; the ninth is left out rather
    // than published as a one-hour bar pretending to be four.
    expect(aggregate(hourly, 4)).toHaveLength(2);
  });
});

describe("dropUnclosedBar", () => {
  const now = Date.UTC(2024, 0, 1, 10, 30);

  it("removes a candle that is still forming", () => {
    const bars = [
      { time: Date.UTC(2024, 0, 1, 9), open: 1, high: 1, low: 1, close: 1 },
      { time: Date.UTC(2024, 0, 1, 10), open: 1, high: 1, low: 1, close: 1 },
    ];
    expect(dropUnclosedBar(bars, "H1", now)).toHaveLength(1);
  });

  it("keeps a candle whose period has elapsed", () => {
    const bars = [
      { time: Date.UTC(2024, 0, 1, 8), open: 1, high: 1, low: 1, close: 1 },
      { time: Date.UTC(2024, 0, 1, 9), open: 1, high: 1, low: 1, close: 1 },
    ];
    expect(dropUnclosedBar(bars, "H1", now)).toHaveLength(2);
  });
});
