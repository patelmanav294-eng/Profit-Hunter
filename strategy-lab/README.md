# Strategy Lab

A backtesting engine for trading strategies. Write rules, run them over historical bars, get numbers that are honest about their own limitations.

Standalone project — no dependency on anything else in this repository.

```bash
cd strategy-lab
npm install

npm run dev                  # the app, at http://localhost:5273
npm run backtest -- --list   # or from the terminal
npm run sweep -- --synthetic # search Supertrend + EMA parameters
npm test                     # 274 tests
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
| **Indicators** | `ema 50`, `sma 20`, `rsi 14`, `atr 14`, `adx 14`, `macd`, `macd signal`, `macd hist`, `bb upper`, `bb lower`, `bb middle`, `stoch k`, `stoch d`, `supertrend`, `supertrend direction`, `highest 20`, `lowest 20` |
| **Comparisons** | `>` `<` `>=` `<=`, `above`, `below`, `crosses above`, `crosses below` |
| **Combining** | `and`, `or`, `not`, parentheses |

Periods are optional where a convention exists (`rsi` = 14, `macd` = 12/26/9, `bb` = 20/2, `supertrend` = 10/3). `ema50` and `ema 50` both work.

```
close < bb lower and rsi < 30
supertrend direction crosses above 0 and close > ema 200
(adx > 25 and macd crosses above macd signal) or close > highest 20
```

`supertrend direction` runs −1 in a downtrend and +1 in an uptrend, so crossing zero is exactly the flip bar — an event rather than a state that would re-trigger every bar.

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

## Parameter sweep

Searching a grid for the best parameters is the fastest way to fool yourself, so the sweep is built to make that difficult.

```bash
npm run sweep -- --csv ./XAUUSD_H1.csv --symbol XAUUSD --win-rate 60
npm run sweep -- --synthetic --bars 9000 --pine
```

It varies Supertrend period × multiplier × EMA period × stop ATR multiple — 108 combinations by default. Reward-to-risk is deliberately **not** in the grid: that is a risk decision you make, not a number to fit.

Four things keep it honest:

1. **Ranking happens on the first 70% of the data only.** The rest is held back and never influences which combination wins.
2. **The winner is then reported on the held-back data.** The gap between the two columns is the overfitting, measured rather than assumed.
3. **Every combination's out-of-sample result is kept**, so the winner can be compared against the median. If picking the in-sample best lands you near the median out-of-sample, the search learned nothing.
4. **Spearman rank correlation between the two rankings is printed outright.** Near zero means in-sample performance does not predict out-of-sample performance — which is the whole ballgame.

```
  DIAGNOSTICS
    Rank correlation            -0.095   (in-sample rank vs out-of-sample rank)
    Median OS expectancy        0.109R
    Winner OS expectancy        0.466R
    Hit 60% win + PF 1.5        0 in-sample, 0 out-of-sample, 0 both
```

That output is from a sweep over random-walk data, and it reads exactly as it should: the ranking is uninformative, and nothing hit the target.

> **On a 60% win rate at 1:2.** Breakeven at 1:2 is a 33.3% win rate. Sixty percent would be an expectancy of +0.8R per trade — an extraordinary edge, well beyond what most professional funds sustain. The tool will tell you honestly when a grid produces it, and honestly is usually "this held in-sample and collapsed out-of-sample."

---

## TradingView export

Any strategy can be emitted as a Pine v5 script — the **Pine Script** button in the app, `--pine` on either CLI, or `--out script.pine` to write a file. Paste it into Pine Editor and add it to a chart.

The translation preserves the engine's execution semantics, which line up with Pine's defaults: `process_orders_on_close=false` fills at the next bar's open, `pyramiding=0` holds one position, and stop distances are captured on the signal bar then applied to `strategy.position_avg_price` so risk is sized off the real fill.

One trap worth knowing about: **TradingView's `ta.supertrend` returns −1 for an uptrend.** Strategy Lab uses +1. The generated script negates it on the line after the call, so every long and short condition means what it says. Hand-porting without that flip inverts the whole strategy.

Where the two genuinely differ — commission rounding, and which level filled on a bar that touched both stop and target — the generated script says so in a header comment rather than diverging quietly.

---

## Data

**Download it** — one command, no account, no API key:

```bash
npm run fetch -- --symbol "XAUUSD=X" --timeframe H1 --out XAUUSD_H1.csv
npm run fetch -- --source binance --symbol BTCUSDT --timeframe H4 --out BTC_H4.csv
```

Yahoo tickers: spot gold `XAUUSD=X`, gold futures `GC=F`, FX pairs like `EURUSD=X`, indices like `^GSPC`. Hourly history reaches back about two years, daily about ten. Binance takes exchange pairs (`BTCUSDT`) and has no such limit.

**CSV import** handles MetaTrader exports, TradingView downloads and generic dumps. The parser sniffs the delimiter, column order and date format; bars whose high/low do not contain their open/close are rejected rather than repaired, and duplicate timestamps are dropped.

When a file yields nothing, the error says what the file looked like instead of blaming a row — the common failure is not a malformed price file but a file that was never price data:

```
  This file does not look like OHLC price data. No column named time, open,
  high, low or close was found — the first line reads "OFFICE ATTENDANCE -
  JUNE 2026,,,,," which parses as 6 columns: Date, Day, Time In, Time Out…
```

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
  indicators.ts   SMA, EMA, RSI, MACD, ATR, Bollinger, Stochastic, ADX, Supertrend, Donchian
  strategy.ts     the strategy DSL and its validator
  evaluate.ts     indicator compilation and condition evaluation
  backtest.ts     the simulation loop
  metrics.ts      performance statistics

src/data/         CSV parsing, synthetic generation, live adapters
src/strategies/   the rule parser, form builder, preset strategies
src/optimize/     parameter sweep with in-sample / out-of-sample split
src/export/       TradingView Pine v5 generator
src/ui/           React app; backtests run in a Web Worker
src/cli/          data downloader, backtest runner, sweep runner
server/proxy.ts   dev-only CORS proxy for the data providers
tests/            274 tests
```

---

## On testing

The suite that matters most is `tests/causality.test.ts`. It recomputes every indicator over truncated history and demands byte-identical prefixes: if a value at bar `i` depends on anything after bar `i`, the prefix changes and the build fails. The engine gets the same treatment at the trade level — running over more data must not alter trades that already closed.

Look-ahead bias is the failure mode that makes a backtest confidently wrong, and it is invisible in the output. It has to be caught mechanically.

There is a second, subtler variety the truncation test cannot see: depending on the *unfinished remainder of the current bar*. An order filling at bar `k`'s open cannot know bar `k`'s high, low or close — but an engine reading `ATR[k]` to size the stop agrees with itself whether or not later bars exist, so truncation catches nothing. `tests/backtest.test.ts` covers it by perturbing the entry bar's own range and demanding the stop, target and position size come out identical. That test found a real leak in this engine.

---

## What this does not do

- **One position at a time.** No pyramiding, no hedging, no portfolios.
- **Single instrument per run.** No cross-market strategies.
- **No intrabar data.** Stops and targets are resolved against bar highs and lows, with the ambiguity handled pessimistically. Tick-accurate fills need tick data.
- **Constant currency conversion.** `quoteToAccountRate` is a fixed number, so a pair whose quote currency is not your account currency carries whatever error that rate drifts by.

---

## Where a result stops meaning anything

The report prints its own caveats, but the short version: under ~100 trades the statistics are noise; a strategy that only beats random data at the 60th percentile has not shown you an edge; and a backtest tuned until it looks good is a description of the past, not a prediction.

MIT.
