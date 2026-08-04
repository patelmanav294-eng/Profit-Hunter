#!/usr/bin/env node
/**
 * Downloads historical bars to a CSV file.
 *
 * Exists so getting data is one command rather than a hunt through a broker's
 * export menus:
 *
 *   npm run fetch -- --symbol "XAUUSD=X" --timeframe H1 --out XAUUSD_H1.csv
 *   npm run fetch -- --source binance --symbol BTCUSDT --timeframe H4 --out BTC_H4.csv
 *
 * Both providers are keyless. Yahoo limits how far back each interval goes —
 * hourly bars reach about two years, daily bars about ten.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { binanceSource, yahooSource, type MarketDataSource, type Timeframe } from "../data/adapters";
import { toCsv } from "../data/csv";

interface Options {
  source: string;
  symbol?: string;
  timeframe: Timeframe;
  limit: number;
  out?: string;
  help: boolean;
}

const SOURCES: Record<string, MarketDataSource> = {
  yahoo: yahooSource,
  binance: binanceSource,
};

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const DEFAULTS: Options = {
  source: "yahoo",
  timeframe: "H1",
  limit: 20_000,
  help: false,
};

const HELP = `
Strategy Lab — historical data downloader

  --source <yahoo|binance>   Where to fetch from (default yahoo)
  --symbol <SYMBOL>          Ticker to download (required)
  --timeframe <TF>           M1 M5 M15 M30 H1 H4 D1 W1 (default H1)
  --limit <n>                Maximum bars to keep (default 20000)
  --out <path>               CSV file to write (default <symbol>_<timeframe>.csv)
  --help, -h                 This message

Symbols

  yahoo     Spot gold  XAUUSD=X      Gold futures  GC=F
            EUR/USD    EURUSD=X      GBP/USD       GBPUSD=X
            USD/JPY    USDJPY=X      S&P 500       ^GSPC
            Any Yahoo Finance ticker works. FX pairs end in "=X".

  binance   Exchange pairs with no separator: BTCUSDT, ETHUSDT, SOLUSDT

Then feed the file to a backtest or a sweep:

  npm run sweep -- --csv ./XAUUSD_H1.csv --symbol XAUUSD --win-rate 60
`;

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--source":
        options.source = next().toLowerCase();
        break;
      case "--symbol":
      case "-s":
        options.symbol = next();
        break;
      case "--timeframe":
      case "-t":
        options.timeframe = next().toUpperCase() as Timeframe;
        break;
      case "--limit":
        options.limit = Number(next());
        break;
      case "--out":
      case "-o":
        options.out = next();
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option "${arg}". Run with --help to see what is available.`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const source = SOURCES[options.source];
  if (!source) {
    process.stderr.write(`Unknown source "${options.source}". Use one of: ${Object.keys(SOURCES).join(", ")}\n`);
    process.exit(1);
  }
  if (!options.symbol) {
    process.stderr.write(`Missing --symbol. ${source.symbolHint}\n`);
    process.exit(1);
  }
  if (!VALID_TIMEFRAMES.includes(options.timeframe)) {
    process.stderr.write(`Unknown timeframe "${options.timeframe}". Use one of: ${VALID_TIMEFRAMES.join(", ")}\n`);
    process.exit(1);
  }

  const outPath = options.out ?? `${options.symbol.replace(/[^a-zA-Z0-9]/g, "")}_${options.timeframe}.csv`;

  process.stdout.write(`\n  Fetching ${options.symbol} ${options.timeframe} from ${source.label}…\n`);

  let bars;
  try {
    bars = await source.fetchBars({
      symbol: options.symbol,
      timeframe: options.timeframe,
      limit: options.limit,
    });
  } catch (error) {
    process.stderr.write(`\n  Fetch failed: ${(error as Error).message}\n\n`);
    process.stderr.write(`  Check the symbol spelling — ${source.symbolHint}\n\n`);
    process.exit(1);
  }

  if (bars.length === 0) {
    process.stderr.write(`\n  The provider returned no bars for "${options.symbol}".\n`);
    process.stderr.write(`  ${source.symbolHint}\n\n`);
    process.exit(1);
  }

  writeFileSync(resolve(outPath), toCsv(bars), "utf8");

  const first = new Date(bars[0].time).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1].time).toISOString().slice(0, 10);

  process.stdout.write(`  Wrote ${bars.length.toLocaleString()} bars to ${outPath}\n`);
  process.stdout.write(`  Range: ${first} → ${last}\n\n`);

  // A sweep splits the data and needs enough on both sides to mean anything.
  if (bars.length < 2000) {
    process.stdout.write(
      `  Note: ${bars.length} bars is thin for a parameter sweep. Try a longer timeframe,\n` +
        "  or accept that the out-of-sample half will be very small.\n\n",
    );
  }
}

void main();
