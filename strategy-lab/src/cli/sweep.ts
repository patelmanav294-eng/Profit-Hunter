#!/usr/bin/env node
/**
 * Parameter sweep runner.
 *
 *   npm run sweep -- --synthetic --bars 8000
 *   npm run sweep -- --csv ./XAUUSD_H1.csv --symbol XAUUSD --win-rate 60
 *   npm run sweep -- --csv ./data.csv --pine        # print the winner's Pine script
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describeParseFailure, parseCsv } from "../data/csv";
import { getInstrument } from "../data/instruments";
import { generateBars } from "../data/synthetic";
import type { BacktestConfig } from "../engine/backtest";
import type { Metrics } from "../engine/metrics";
import { strategyToPine } from "../export/pine";
import { DEFAULT_TARGETS, runSweep, type SweepReport, type SweepRow } from "../optimize/sweep";
import { formatPercent, formatRatio } from "../report";
import { buildFromSweepParams, DEFAULT_SWEEP_SPACE } from "../strategies/supertrendEma";
import type { Bar } from "../engine/types";

interface Options {
  csv?: string;
  symbol: string;
  synthetic: boolean;
  bars: number;
  seed: number;
  balance: number;
  spread: number;
  commission: number;
  slippage: number;
  inSample: number;
  minTrades: number;
  winRate: number;
  reward: number;
  risk: number;
  top: number;
  pine: boolean;
  out?: string;
  help: boolean;
}

const DEFAULTS: Options = {
  symbol: "EURUSD",
  synthetic: false,
  bars: 8000,
  seed: 42,
  balance: 10_000,
  spread: 1,
  commission: 0,
  slippage: 0,
  inSample: 0.7,
  minTrades: 30,
  winRate: 60,
  reward: 2,
  risk: 1,
  top: 10,
  pine: false,
  help: false,
};

const HELP = `
Strategy Lab — Supertrend + EMA parameter sweep

  --csv, -c <path>       OHLC file to sweep over
  --symbol <SYMBOL>      Instrument spec (default EURUSD)
  --synthetic            Generate random-walk bars instead of loading a file
  --bars <n>             Synthetic bar count (default 8000)
  --seed <n>             Synthetic seed (default 42)

  --in-sample <0..1>     Fraction used for ranking; the rest is held back (default 0.7)
  --min-trades <n>       Combinations below this are not ranked (default 30)
  --win-rate <percent>   Win-rate target to report against (default 60)
  --reward <n>           Reward-to-risk ratio, fixed across the grid (default 2)
  --risk <percent>       Equity risked per trade (default 1)

  --balance <n>          Starting balance (default 10000)
  --spread <pips>        Spread in pips (default 1)
  --commission <n>       Commission per lot per side (default 0)
  --slippage <pips>      Slippage in pips (default 0)

  --top <n>              Rows to print (default 10)
  --pine                 Print the winner as a TradingView Pine v5 script
  --out <path>           Write the Pine script to a file instead of stdout
  --help, -h             This message

The grid: Supertrend period x multiplier x EMA period x stop ATR multiple.
Reward-to-risk is held fixed — it is your risk decision, not something to fit.
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
    const num = (): number => {
      const raw = next();
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number, got "${raw}"`);
      return value;
    };

    switch (arg) {
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
      case "--in-sample":
        options.inSample = num();
        break;
      case "--min-trades":
        options.minTrades = num();
        break;
      case "--win-rate":
        options.winRate = num();
        break;
      case "--reward":
        options.reward = num();
        break;
      case "--risk":
        options.risk = num();
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
      case "--top":
        options.top = num();
        break;
      case "--pine":
        options.pine = true;
        break;
      case "--out":
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

function loadBars(options: Options): Bar[] {
  if (options.csv) {
    const parsed = parseCsv(readFileSync(resolve(options.csv), "utf8"));
    if (parsed.bars.length === 0) {
      throw new Error(describeParseFailure(parsed, options.csv));
    }
    if (parsed.rejected > 0) {
      process.stderr.write(`  note: skipped ${parsed.rejected} unusable rows\n`);
    }
    return parsed.bars;
  }

  return generateBars({
    bars: options.bars,
    startPrice: options.symbol.toUpperCase().includes("JPY") ? 150 : 1.1,
    volatility: 0.002,
    drift: 0,
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
  if (!options.csv && !options.synthetic) {
    process.stderr.write("No data — pass --csv <path> or --synthetic.\n");
    process.exit(1);
  }

  // Data problems are the user's to fix, not a crash — print the explanation
  // rather than a stack trace through the loader.
  let bars: Bar[];
  try {
    bars = loadBars(options);
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
  };

  let lastPercent = -1;
  const report = runSweep({
    bars,
    space: DEFAULT_SWEEP_SPACE,
    build: params => buildFromSweepParams(params, { rewardRatio: options.reward, riskPercent: options.risk }),
    config,
    inSampleFraction: options.inSample,
    minTrades: options.minTrades,
    targets: { ...DEFAULT_TARGETS, minWinRate: options.winRate / 100, minTrades: options.minTrades },
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100);
      if (percent !== lastPercent && percent % 10 === 0) {
        lastPercent = percent;
        process.stderr.write(`\r  sweeping… ${percent}%`);
      }
    },
  });
  process.stderr.write("\r                    \r");

  process.stdout.write(formatSweep(report, options, bars));

  if (options.pine || options.out) {
    if (!report.best) {
      process.stderr.write("No winner to export.\n");
      process.exit(1);
    }
    const strategy = buildFromSweepParams(report.best.params, {
      rewardRatio: options.reward,
      riskPercent: options.risk,
    });
    const script = strategyToPine(strategy, {
      instrument: config.instrument,
      costs: config.costs,
      initialCapital: options.balance,
    });

    if (options.out) {
      writeFileSync(resolve(options.out), script, "utf8");
      process.stdout.write(`  Pine script written to ${options.out}\n\n`);
    } else {
      process.stdout.write(`\n${"─".repeat(64)}\n${script}\n`);
    }
  }
}

function formatSweep(report: SweepReport, options: Options, bars: Bar[]): string {
  const lines: string[] = [];
  const rule = "─".repeat(96);

  lines.push("");
  lines.push(rule);
  lines.push(`  Supertrend + EMA sweep · ${options.symbol} · ${bars.length.toLocaleString()} bars`);
  lines.push(
    `  ${report.combinations} combinations · ${report.inSampleBars.toLocaleString()} bars to rank on, ` +
      `${report.outOfSampleBars.toLocaleString()} held back`,
  );
  lines.push(rule);
  lines.push("");

  const ranked = report.rows.filter(row => !row.excluded).slice(0, options.top);
  if (ranked.length === 0) {
    lines.push("  No combination produced enough trades to rank.\n");
    for (const warning of report.warnings) lines.push(`  ! ${warning}`);
    return `${lines.join("\n")}\n`;
  }

  // Column widths mirror formatRow exactly: 25 for the parameters, 29 for the
  // in-sample block, 35 for out-of-sample.
  const inSampleHeader = `${"IS trades".padStart(9)}  ${"IS win".padStart(7)}  ${"IS exp".padStart(7)}  `;
  const outSampleHeader = `${"OS trades".padStart(9)}  ${"OS win".padStart(7)}  ${"OS exp".padStart(7)}  ${"OS PF".padStart(6)}`;

  lines.push(`    ${"ST".padEnd(9)}${"EMA".padEnd(6)}${"Stop".padEnd(6)}│${inSampleHeader}│${outSampleHeader}`);
  lines.push(`    ${"─".repeat(21)}┼${"─".repeat(29)}┼${"─".repeat(35)}`);

  for (const row of ranked) {
    lines.push(formatRow(row));
  }

  lines.push("");
  lines.push("  DIAGNOSTICS");
  lines.push(
    `    ${"Rank correlation".padEnd(28)}${report.rankCorrelation === null ? "n/a" : report.rankCorrelation.toFixed(3)}` +
      "   (in-sample rank vs out-of-sample rank)",
  );
  lines.push(
    `    ${"Median OS expectancy".padEnd(28)}${report.medianOutOfSampleScore === null ? "n/a" : `${report.medianOutOfSampleScore.toFixed(3)}R`}`,
  );
  if (report.best?.outOfSample) {
    lines.push(
      `    ${"Winner OS expectancy".padEnd(28)}${(report.best.outOfSample.expectancyR ?? 0).toFixed(3)}R`,
    );
  }
  lines.push(
    `    ${`Hit ${options.winRate}% win + PF ${report.targets.minProfitFactor}`.padEnd(28)}` +
      `${report.targetHits.inSample} in-sample, ${report.targetHits.outOfSample} out-of-sample, ${report.targetHits.both} both`,
  );
  lines.push("");

  lines.push("  READ THIS BEFORE PICKING A ROW");
  for (const warning of report.warnings) {
    lines.push(`    ! ${wrap(warning, 90, 6)}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatRow(row: SweepRow): string {
  const p = row.params;
  const is = row.inSample!;
  const os = row.outOfSample!;
  const mark = row.meetsTargetsInSample && row.meetsTargetsOutOfSample ? " ★" : "  ";

  return (
    `  ${mark}${`${p.stPeriod}/${p.stMultiplier}`.padEnd(9)}${String(p.emaPeriod).padEnd(6)}${String(p.stopAtrMultiple).padEnd(6)}│` +
    `${String(is.totalTrades).padStart(9)}  ${formatPercent(is.winRate * 100, 1).padStart(7)}  ${expectancy(is).padStart(7)}  │` +
    `${String(os.totalTrades).padStart(9)}  ${formatPercent(os.winRate * 100, 1).padStart(7)}  ${expectancy(os).padStart(7)}  ${formatRatio(os.profitFactor).padStart(6)}`
  );
}

function expectancy(metrics: Metrics): string {
  const value = metrics.expectancyR;
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

/** Wraps long warning text so the report stays readable in a narrow terminal. */
function wrap(text: string, width: number, indent: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);

  return lines.join(`\n${" ".repeat(indent)}`);
}

main();
