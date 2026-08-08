# Standalone backtest for the Gold/Silver/UKOil confluence strategy
# (mirrors trend-anchor-signals.pine / the Pine strategy file).
# Downloads the last 2 years of hourly data from Yahoo Finance (no API key
# needed) and reports real Win Rate, Profit Factor, and R:R per instrument.
# Requires: pandas, numpy  (pip install pandas numpy)
# Run: python3 pine-scripts/backtest.py
import json
import urllib.request
import urllib.parse
import numpy as np
import pandas as pd

HEADERS = {"User-Agent": "Mozilla/5.0"}

SYMBOLS = {
    "XAUUSD (Gold, via GC=F futures)": "GC=F",
    "XAGUSD (Silver, via SI=F futures)": "SI=F",
    "UKOIL (Brent Crude, via BZ=F futures)": "BZ=F",
}

# (SL_ATR_MULT, TP1_RR, TP2_RR) chosen on the training half only - see README.
# UKOil has no setting that survived out-of-sample and is kept here only so the
# comparison keeps showing why it should not be traded with this strategy.
PER_SYMBOL_SETTINGS = {
    "GC=F": (2.0, 2.5, 5.0),
    "SI=F": (1.0, 2.0, 3.0),
    "BZ=F": (1.0, 2.5, 5.0),
}

# ---------------- Data fetch ----------------

def fetch_yahoo(ticker, rng="730d", interval="60m"):
    """730d = the last 2 years, which is also Yahoo's limit for hourly bars."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range={rng}&interval={interval}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    result = data["chart"]["result"][0]
    ts = result["timestamp"]
    quote = result["indicators"]["quote"][0]
    df = pd.DataFrame({
        "time": pd.to_datetime(ts, unit="s", utc=True),
        "open": quote["open"],
        "high": quote["high"],
        "low": quote["low"],
        "close": quote["close"],
        "volume": quote.get("volume"),
    })
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    return df

# ---------------- Indicators (Wilder RMA to match Pine ta.rsi / ta.atr) ----------------

def rma(series: pd.Series, length: int) -> pd.Series:
    values = series.to_numpy(dtype=float)
    out = np.full(len(values), np.nan)
    if len(values) < length:
        return pd.Series(out, index=series.index)
    out[length - 1] = values[:length].mean()
    alpha = 1.0 / length
    for i in range(length, len(values)):
        out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
    return pd.Series(out, index=series.index)


def rsi(close: pd.Series, length: int) -> pd.Series:
    delta = close.diff()
    # first bar has no prior close -> no gain/loss, not NaN (NaN here would poison rma's seed mean)
    gain = delta.clip(lower=0).fillna(0)
    loss = (-delta.clip(upper=0)).fillna(0)
    avg_gain = rma(gain, length)
    avg_loss = rma(loss, length)
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    out[(avg_loss == 0) & (avg_gain > 0)] = 100
    out[(avg_loss == 0) & (avg_gain == 0)] = 50
    return out


def macd(close: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line


def atr(df: pd.DataFrame, length: int) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return rma(tr, length)

# ---------------- Strategy params (must mirror the Pine strategy defaults) ----------------

EMA_FAST_LEN = 9
EMA_SLOW_LEN = 21
RSI_LEN = 14
RSI_BULL_MIN, RSI_BULL_MAX = 45, 75
RSI_BEAR_MAX, RSI_BEAR_MIN = 55, 25
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 12, 26, 9
ATR_LEN = 14
ATR_AVG_LEN = 50
MIN_ATR_RATIO = 0.8
USE_HTF_FILTER = True  # the single biggest edge contributor - see README, do not turn this off
HTF_EMA_LEN = 50
SL_ATR_MULT = 2.0
TP1_RR = 2.5           # TP1 = SL distance x this multiple (partial exit target)
TP1_QTY_FRACTION = 0.5  # fraction of position closed at TP1
TP2_RR = 5.0           # TP2 = SL distance x this multiple (final target for the runner)
MOVE_SL_TO_BREAKEVEN = True  # after TP1 fills, move SL to entry price (cost-to-cost) for the runner
# Round-trip trading cost (spread + slippage) as a fraction of the stop distance,
# charged on each exit. Zero costs flatter the results materially - set this to
# match your own broker rather than leaving the default.
COST_R = 0.05
# The signal tool ships with SELL signals off, because shorts lost money on every
# timeframe tested. Keep this True so the backtest measures what the tool does.
LONGS_ONLY = True


def build_htf_trend(df_1h: pd.DataFrame) -> pd.Series:
    """4H EMA(50) trend, aligned back to the 1H index using only *closed* 4H bars
    (mirrors Pine's request.security(..., lookahead=barmerge.lookahead_off))."""
    htf = df_1h.set_index("time")["close"].resample("4h", label="right", closed="right").last().dropna()
    htf_ema = htf.ewm(span=HTF_EMA_LEN, adjust=False).mean()
    # shift by one completed HTF bar so we never peek at the still-forming bar
    htf_ema_confirmed = htf_ema.shift(1)
    aligned = htf_ema_confirmed.reindex(df_1h["time"], method="ffill")
    aligned.index = df_1h.index
    return aligned


def run_backtest(df: pd.DataFrame, sl_mult: float | None = None,
                 tp1_rr: float | None = None, tp2_rr: float | None = None) -> dict:
    sl_mult = SL_ATR_MULT if sl_mult is None else sl_mult
    tp1_rr = TP1_RR if tp1_rr is None else tp1_rr
    tp2_rr = TP2_RR if tp2_rr is None else tp2_rr
    df = df.copy().reset_index(drop=True)
    df["ema_fast"] = df["close"].ewm(span=EMA_FAST_LEN, adjust=False).mean()
    df["ema_slow"] = df["close"].ewm(span=EMA_SLOW_LEN, adjust=False).mean()
    df["rsi"] = rsi(df["close"], RSI_LEN)
    macd_line, macd_signal = macd(df["close"], MACD_FAST, MACD_SLOW, MACD_SIGNAL)
    df["macd_line"], df["macd_signal"] = macd_line, macd_signal
    df["atr"] = atr(df, ATR_LEN)
    df["atr_avg"] = df["atr"].rolling(ATR_AVG_LEN).mean()
    df["htf_ema"] = build_htf_trend(df) if USE_HTF_FILTER else np.nan

    cross_up = (df["ema_fast"].shift(1) <= df["ema_slow"].shift(1)) & (df["ema_fast"] > df["ema_slow"])
    cross_down = (df["ema_fast"].shift(1) >= df["ema_slow"].shift(1)) & (df["ema_fast"] < df["ema_slow"])

    rsi_bull = df["rsi"].between(RSI_BULL_MIN, RSI_BULL_MAX)
    rsi_bear = df["rsi"].between(RSI_BEAR_MIN, RSI_BEAR_MAX)
    macd_bull = df["macd_line"] > df["macd_signal"]
    macd_bear = df["macd_line"] < df["macd_signal"]
    vol_ok = df["atr"] >= df["atr_avg"] * MIN_ATR_RATIO
    # NOTE: do not write this as (~USE_HTF_FILTER) | series — ~True is -2, which pandas
    # coerces to True, silently disabling the filter.
    if USE_HTF_FILTER:
        htf_bull_ok = df["close"] > df["htf_ema"]
        htf_bear_ok = df["close"] < df["htf_ema"]
    else:
        htf_bull_ok = pd.Series(True, index=df.index)
        htf_bear_ok = pd.Series(True, index=df.index)

    buy_signal = cross_up & rsi_bull & macd_bull & vol_ok & htf_bull_ok
    sell_signal = cross_down & rsi_bear & macd_bear & vol_ok & htf_bear_ok

    remaining_qty = 1 - TP1_QTY_FRACTION
    trades = []
    position = None  # dict with direction, entry, sl, tp1, tp2, tp1_hit, r_total, entry_i

    for i in range(len(df)):
        row = df.iloc[i]

        if position is not None:
            direction = position["direction"]

            if not position["tp1_hit"]:
                if direction == "long":
                    hit_sl = row["low"] <= position["sl"]
                    hit_tp1 = row["high"] >= position["tp1"]
                else:
                    hit_sl = row["high"] >= position["sl"]
                    hit_tp1 = row["low"] <= position["tp1"]

                if hit_sl:
                    # SL hit before TP1 (also the conservative assumption if both hit same bar):
                    # full position stops out for -1R, nothing banked yet
                    position["r_total"] = -1.0 - COST_R
                    position["exit_i"] = i
                    trades.append(position)
                    position = None
                elif hit_tp1:
                    position["tp1_hit"] = True
                    position["r_total"] = (tp1_rr - COST_R) * TP1_QTY_FRACTION
                    if MOVE_SL_TO_BREAKEVEN:
                        position["sl"] = position["entry"]
                    # runner continues, don't close the trade yet
            else:
                if direction == "long":
                    hit_sl = row["low"] <= position["sl"]
                    hit_tp2 = row["high"] >= position["tp2"]
                else:
                    hit_sl = row["high"] >= position["sl"]
                    hit_tp2 = row["low"] <= position["tp2"]

                if hit_sl:
                    # conservative assumption if both hit same bar too: SL/breakeven first
                    stop_r = 0.0 if MOVE_SL_TO_BREAKEVEN else -1.0
                    position["r_total"] += (stop_r - COST_R) * remaining_qty
                    position["exit_i"] = i
                    trades.append(position)
                    position = None
                elif hit_tp2:
                    position["r_total"] += (tp2_rr - COST_R) * remaining_qty
                    position["exit_i"] = i
                    trades.append(position)
                    position = None

        if position is None:
            entry_atr = row["atr"]
            if pd.isna(entry_atr) or entry_atr <= 0:
                continue
            sl_dist = entry_atr * sl_mult
            tp1_dist = sl_dist * tp1_rr
            tp2_dist = sl_dist * tp2_rr

            if bool(buy_signal.iloc[i]):
                position = {
                    "direction": "long", "entry_i": i, "entry": row["close"], "tp1_hit": False, "r_total": 0.0,
                    "sl": row["close"] - sl_dist, "tp1": row["close"] + tp1_dist, "tp2": row["close"] + tp2_dist,
                }
            elif bool(sell_signal.iloc[i]) and not LONGS_ONLY:
                position = {
                    "direction": "short", "entry_i": i, "entry": row["close"], "tp1_hit": False, "r_total": 0.0,
                    "sl": row["close"] + sl_dist, "tp1": row["close"] - tp1_dist, "tp2": row["close"] - tp2_dist,
                }

    n = len(trades)
    r_values = np.array([t["r_total"] for t in trades])
    wins = int((r_values > 0).sum())
    losses = int((r_values < 0).sum())
    scratches = int((r_values == 0).sum())
    win_rate = (wins / n * 100) if n else 0.0
    gross_win_r = r_values[r_values > 0].sum() if n else 0.0
    gross_loss_r = -r_values[r_values < 0].sum() if n else 0.0
    profit_factor = (gross_win_r / gross_loss_r) if gross_loss_r > 0 else float("inf") if gross_win_r > 0 else 0.0
    net_r = r_values.sum() if n else 0.0
    expectancy_r = (net_r / n) if n else 0.0

    equity = np.concatenate(([0.0], np.cumsum(r_values))) if n else np.array([0.0])
    running_max = np.maximum.accumulate(equity)
    drawdown = equity - running_max
    max_dd_r = drawdown.min() if len(drawdown) else 0.0

    return {
        "bars": len(df),
        "trades": n,
        "wins": wins,
        "losses": losses,
        "scratches_breakeven": scratches,
        "win_rate_pct": round(win_rate, 1),
        "tp1_rr": tp1_rr,
        "tp1_qty_pct": round(TP1_QTY_FRACTION * 100),
        "tp2_rr": tp2_rr,
        "move_sl_to_breakeven": MOVE_SL_TO_BREAKEVEN,
        "cost_r_per_exit": COST_R,
        "longs_only": LONGS_ONLY,
        "profit_factor": round(profit_factor, 2) if np.isfinite(profit_factor) else None,
        "net_r": round(float(net_r), 2),
        "expectancy_r": round(float(expectancy_r), 3),
        "max_drawdown_r": round(float(max_dd_r), 2),
        "date_range": f"{df['time'].iloc[0].date()} to {df['time'].iloc[-1].date()}" if len(df) else "n/a",
    }


if __name__ == "__main__":
    summary = []
    for label, ticker in SYMBOLS.items():
        settings = PER_SYMBOL_SETTINGS.get(ticker)
        print(f"\n=== {label} [{ticker}] ===")
        try:
            df = fetch_yahoo(ticker)
            result = run_backtest(df, *settings) if settings else run_backtest(df)
            for k, v in result.items():
                print(f"  {k}: {v}")
            summary.append((label, result))
        except Exception as exc:
            print(f"  ERROR: {exc}")

    if summary:
        print("\n=== Comparison (sorted by expectancy, best first) ===")
        summary.sort(key=lambda item: item[1]["expectancy_r"], reverse=True)
        for label, result in summary:
            print(f"  {label}: win_rate={result['win_rate_pct']}% profit_factor={result['profit_factor']} "
                  f"expectancy={result['expectancy_r']}R max_dd={result['max_drawdown_r']}R "
                  f"trades={result['trades']}")
