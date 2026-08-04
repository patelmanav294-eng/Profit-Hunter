# Strategy Lab

A backtesting engine for trading strategies. Write rules, run them over historical bars, get numbers that are honest about their own limitations.

Standalone project — no dependency on anything else in this repository.

```bash
cd strategy-lab
npm install

npm run dev                  # the app, at http://localhost:5273
npm run backtest -- --list   # or from the terminal
npm test                     # 183 tests
```

---

## What it does

You describe a strategy in plain rules:

```
ema 20 crosses above ema 50 and rsi 14 > 50
```

It gets parsed into a structured strategy, run bar by bar over your data, and reported on: equity curve, drawdown, win rate, profit factor, expectancy in R, Sharpe, exposure, and the full trade log.

Then it does the part most backtesters skip — it replays the same strategy over random-walk data with no edge in it, and tells you where your result falls in that distribution. A 15% return means nothing if noise produces 15% a third of the time.

---

## The execution model

Backtest results are only worth as much as the assumptions underneath them. These are the ones that matter, all of them chosen to be pessimistic rather than flattering:

**Signals are evaluated on a bar's close and execute at the next bar's open.** Nothing is ever decided using a price the strategy could not have seen. This costs a bar of latency and it is the single most important thing in the engine.

**Bars are treated as mid prices.** Every fill pays half the spread, so a round trip pays exactly one full spread — the same for longs and shorts.

**When one bar touches both stop and target, the stop is assumed to have filled first.** Bar data genuinely cannot tell you which came first, and optimism here is how backtests come to show profits that never materialise. Flip it with `--optimistic` to see the other side of the range.

**A gap through a level fills at the open, not at the level.** Stops do not protect you from gaps in real life and they do not here either.

**Slippage applies to market orders and stops, but not take-profits**, which are limit orders that fill at their price or not at all.

**Position sizing rounds down.** Risk-percent sizing rounds lots down to the instrument's lot step, so rounding never pushes risk above the budget. A signal that cannot be sized above the minimum lot is skipped and counted, not silently taken at a larger size.

---

## Rule syntax

| | |
|---|---|
| **Values** | `close`, `open`, `high`, `low`, or any number |
| **Indicators** | `ema 50`, `sma 20`, `rsi 14`, `atr 14`, `adx 14`, `macd`, `macd signal`, `macd hist`, `bb upper`, `bb lower`, `bb middle`, `stoch k`, `stoch d`, `highest 20`, `lowest 20` |
| **Comparisons** | `>` `<` `>=` `<=`, `above`, `below`, `crosses above`, `crosses below` |
| **Combining** | `and`, `or`, `not`, parentheses |

Periods are optional where a convention exists (`rsi` = 14, `macd` = 12/26/9, `bb` = 20/2). `ema50` and `ema 50` both work.

```
close < bb lower and rsi < 30
(adx > 25 and macd crosses above macd signal) or close > highest 20
```

It is a real grammar with precedence and parentheses, not phrase matching — so it is deterministic, runs offline, and every failure points at the exact character that broke.

---

## Command line

```bash
# See what is built in
npm run backtest -- --list

# Run a preset against generated data
npm run backtest -- --strategy "EMA 20/50 Crossover" --synthetic --bars 5000

# Run your own strategy against your own data
npm run backtest -- --strategy ./my-strategy.json --csv ./EURUSD_H1.csv --symbol EURUSD

# Ask whether the result is distinguishable from noise
npm run backtest -- --strategy "Donchian Breakout" --synthetic --noise 50

# Machine-readable output
npm run backtest -- --strategy "RSI Mean Reversion" --synthetic --json
```

`--help` lists every flag.

---

## Data

**CSV import** handles MetaTrader exports, TradingView downloads and generic dumps. The parser sniffs the delimiter, column order and date format; bars whose high/low do not contain their open/close are rejected rather than repaired, and duplicate timestamps are dropped.

**Live fetch** from Binance (crypto, keyless) or Yahoo Finance (FX, indices, equities, keyless). Neither sends CORS headers, so browser fetches go through a small local proxy:

```bash
npm run proxy      # in a second terminal, then use the Fetch button
```

**Synthetic bars** are a seeded random walk with zero expected return. Useful for demos, and essential for the noise comparison.

> The generator applies the Itô convexity correction, so zero drift really means zero expected return. Without it, exponentiating zero-mean shocks adds a hidden upward drift of σ²/2 per bar — and a noise baseline that drifts upward flatters every strategy measured against it.

---

## Project layout

```
src/engine/       the backtester — zero dependencies, runs anywhere
  types.ts        bars, trades, instruments, costs
  indicators.ts   SMA, EMA, RSI, MACD, ATR, Bollinger, Stochastic, ADX, Donchian
  strategy.ts     the strategy DSL and its validator
  evaluate.ts     indicator compilation and condition evaluation
  backtest.ts     the simulation loop
  metrics.ts      performance statistics

src/data/         CSV parsing, synthetic generation, live adapters
src/strategies/   the rule parser, form builder, preset strategies
src/ui/           React app; backtests run in a Web Worker
src/cli/          terminal runner
server/proxy.ts   dev-only CORS proxy for the data providers
tests/            183 tests
```

---

## On testing

The suite that matters most is `tests/causality.test.ts`. It recomputes every indicator over truncated history and demands byte-identical prefixes: if a value at bar `i` depends on anything after bar `i`, the prefix changes and the build fails. The engine gets the same treatment at the trade level — running over more data must not alter trades that already closed.

Look-ahead bias is the failure mode that makes a backtest confidently wrong, and it is invisible in the output. It has to be caught mechanically.

---

## What this does not do

- **One position at a time.** No pyramiding, no hedging, no portfolios.
- **Single instrument per run.** No cross-market strategies.
- **No intrabar data.** Stops and targets are resolved against bar highs and lows, with the ambiguity handled pessimistically. Tick-accurate fills need tick data.
- **No parameter optimisation.** Deliberately. A grid search over a few thousand combinations will always find something that looks good on one dataset, and building that in makes overfitting the path of least resistance. Change one thing, check it against noise, then change the next.
- **Constant currency conversion.** `quoteToAccountRate` is a fixed number, so a pair whose quote currency is not your account currency carries whatever error that rate drifts by.

---

## Where a result stops meaning anything

The report prints its own caveats, but the short version: under ~100 trades the statistics are noise; a strategy that only beats random data at the 60th percentile has not shown you an edge; and a backtest tuned until it looks good is a description of the past, not a prediction.

MIT.
