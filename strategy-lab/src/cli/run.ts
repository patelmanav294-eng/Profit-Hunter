#!/usr/bin/env node
/**
 * Command-line backtest runner.
 *
 *   npm run backtest -- --list
 *   npm run backtest -- --strategy "EMA 20/50 Crossover" --synthetic --bars 3000
 *   npm run backtest -- --strategy ./my-strategy.json --csv ./EURUSD_H1.csv --symbol EURUSD
 *   npm run backtest -- --strategy "Donchian Breakout" --noise 20
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describeParseFailure, parseCsv } from "../data/csv";
import { getInstrument } from "../data/instruments";
import { generateBars } from "../data/synthetic";
import { runBacktest, type BacktestConfig } from "../engine/backtest";
import type { Strategy } from "../engine/strategy";
import { validateStrategy } from "../engine/strategy";
import type { Bar } from "../engine/types";
import { strategyToPine } from "../export/pine";
import { collectWarnings, formatPercent, formatReport, formatTrades } from "../report";
import { PRESETS } from "../strategies/presets";

interface Options {
  strategy?: string;
  csv?: string;
  symbol: string;
  synthetic: boolean;
  bars: number;
  seed: number;
  volatility: number;
  drift: number;
  balance: number;
  spread: number;
  commission: number;
  slippage: number;
  noise: number;
  trades: number;
  pine: boolean;
  json: boolean;
  optimistic: boolean;
  list: boolean;
  help: boolean;
}

const DEFAULTS: Options = {
  symbol: "EURUSD",
  synthetic: false,
  bars: 3000,
  seed: 42,
  volatility: 0.002,
  drift: 0,
  balance: 10_000,
  spread: 1,
  commission: 0,
  slippage: 0,
  noise: 0,
  trades: 20,
  pine: false,
  json: false,
  optimistic: false,
  list: false,
  help: false,
};

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    const num = (): number => {
      const raw = next();
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number, got "${raw}"`);
      return value;
    };

    switch (arg) {
      case "--strategy":
      case "-s":
        options.strategy = next();
        break;
      case "--csv":
      case "-c":
        options.csv = next();
        break;
      case "--symbol":
        options.symbol = next();
        break;
      case "--synthetic":
        options.synthetic = true;
        break;
      case "--bars":
        options.bars = num();
        break;
      case "--seed":
        options.seed = num();
        break;
      case "--volatility":
        options.volatility = num();
        break;
      case "--drift":
        options.drift = num();
        break;
      case "--balance":
        options.balance = num();
        break;
      case "--spread":
        options.spread = num();
        break;
      case "--commission":
        options.commission = num();
        break;
      case "--slippage":
        options.slippage = num();
        break;
      case "--noise":
        options.noise = num();
        break;
      case "--trades":
        options.trades = num();
        break;
      case "--pine":
        options.pine = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--optimistic":
        options.optimistic = true;
        break;
      case "--list":
        options.list = true;
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

const HELP = `
Strategy Lab — backtest runner

  --strategy, -s <name|path>  Preset name, or path to a strategy JSON file
  --csv, -c <path>            OHLC file to test against
  --symbol <SYMBOL>           Instrument spec to use (default EURUSD)
  --synthetic                 Generate random-walk bars instead of loading a file
  --bars <n>                  Synthetic bar count (default 3000)
  --seed <n>                  Synthetic seed (default 42)
  --volatility <n>            Synthetic per-bar volatility (default 0.002)
  --drift <n>                 Synthetic per-bar drift (default 0, i.e. no edge)

  --balance <n>               Starting balance (default 10000)
  --spread <pips>             Spread in pips (default 1)
  --commission <n>            Commission per lot per side (default 0)
  --slippage <pips>           Slippage in pips (default 0)
  --optimistic                Assume the target filled first on ambiguous bars

  --noise <n>                 Also run against n random-walk datasets and report
                              the distribution — a quick curve-fit check
  --trades <n>                How many trades to print (default 20, 0 to hide)
  --pine                      Also emit a TradingView Pine v5 script for this strategy
  --json                      Emit machine-readable JSON instead of a report
  --list                      Show the built-in strategies
  --help, -h                  This message
`;

function loadStrategy(reference: string): Strategy {
  const preset = PRESETS.find(p => p.name.toLowerCase() === reference.toLowerCase());
  if (preset) return preset;

  let raw: string;
  try {
    raw = readFileSync(resolve(reference), "utf8");
  } catch {
    const names = PRESETS.map(p => `"${p.name}"`).join(", ");
    throw new Error(`No preset called "${reference}" and no readable file at that path.\nPresets: ${names}`);
  }

  const parsed = JSON.parse(raw) as Strategy;
  const issues = validateStrategy(parsed);
  if (issues.length > 0) {
    throw new Error(`Strategy file is not valid:\n${issues.map(i => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  return parsed;
}

function loadBars(options: Options): Bar[] {
  if (options.csv) {
    const text = readFileSync(resolve(options.csv), "utf8");
    const parsed = parseCsv(text);
    if (parsed.bars.length === 0) {
      throw new Error(describeParseFailure(parsed, options.csv));
    }
    if (parsed.rejected > 0) {
      process.stderr.write(`  note: skipped ${parsed.rejected} unusable rows in ${options.csv}\n`);
    }
    return parsed.bars;
  }

  return generateBars({
    bars: options.bars,
    startPrice: options.symbol.toUpperCase().includes("JPY") ? 150 : 1.1,
    volatility: options.volatility,
    drift: options.drift,
    seed: options.seed,
  });
}

function main(): void {
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

  if (options.list) {
    process.stdout.write("\n  Built-in strategies\n\n");
    for (const preset of PRESETS) {
      process.stdout.write(`    ${preset.name}\n      ${preset.description ?? ""}\n\n`);
    }
    return;
  }

  if (!options.strategy) {
    process.stderr.write("Nothing to run — pass --strategy <name|path>, or --list to see the presets.\n");
    process.exit(1);
  }

  if (!options.csv && !options.synthetic) {
    process.stderr.write("No data — pass --csv <path> to load a file, or --synthetic to generate bars.\n");
    process.exit(1);
  }

  // Bad strategy files and unreadable data are user errors; show the message
  // on its own rather than burying it in a stack trace.
  let strategy: Strategy;
  let data: Bar[];
  try {
    strategy = loadStrategy(options.strategy);
    data = loadBars(options);
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    process.exit(1);
  }

  const config: BacktestConfig = {
    instrument: getInstrument(options.symbol),
    costs: {
      spreadPips: options.spread,
      commissionPerLotPerSide: options.commission,
      slippagePips: options.slippage,
    },
    initialBalance: options.balance,
    intrabarPriority: options.optimistic ? "optimistic" : "pessimistic",
  };

  const result = runBacktest(data, strategy, config);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          strategy: result.strategyName,
          barCount: result.barCount,
          warmupBars: result.warmupBars,
          metrics: result.metrics,
          warnings: collectWarnings(result),
          trades: result.trades,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`\n${formatReport(result)}\n`);

  if (options.trades > 0) {
    process.stdout.write(`  TRADES\n${formatTrades(result.trades, options.trades)}\n\n`);
  }

  if (options.noise > 0) {
    process.stdout.write(runNoiseCheck(strategy, config, options));
  }

  if (options.pine) {
    const script = strategyToPine(strategy, {
      instrument: config.instrument,
      costs: config.costs,
      initialCapital: options.balance,
    });
    process.stdout.write(`${"─".repeat(64)}\n${script}\n`);
  }
}

/**
 * Runs the same strategy over random-walk data with zero drift.
 *
 * There is no edge in that data, so a strategy landing near the top of this
 * distribution on real prices has probably found something. One landing in the
 * middle has found the distribution itself.
 */
function runNoiseCheck(strategy: Strategy, config: BacktestConfig, options: Options): string {
  const startPrice = options.symbol.toUpperCase().includes("JPY") ? 150 : 1.1;
  const returns: number[] = [];

  for (let i = 0; i < options.noise; i++) {
    const noiseBars = generateBars({
      bars: options.bars,
      startPrice,
      volatility: options.volatility,
      drift: 0,
      seed: 10_000 + i,
    });
    returns.push(runBacktest(noiseBars, strategy, config).metrics.netProfitPercent);
  }

  returns.sort((a, b) => a - b);
  const median = returns[Math.floor(returns.length / 2)];
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const best = returns[returns.length - 1];
  const worst = returns[0];
  const profitable = returns.filter(r => r > 0).length;

  return [
    `  NOISE CHECK  (${options.noise} random-walk runs, zero drift)`,
    `    ${"Mean return".padEnd(24)}${formatPercent(mean)}`,
    `    ${"Median return".padEnd(24)}${formatPercent(median)}`,
    `    ${"Best / worst".padEnd(24)}${formatPercent(best)} / ${formatPercent(worst)}`,
    `    ${"Runs in profit".padEnd(24)}${profitable} of ${options.noise}`,
    "",
    "    On data with no edge, a sound strategy loses roughly its costs.",
    "    Compare your real-data return against this spread before trusting it.",
    "",
  ].join("\n");
}

main();
