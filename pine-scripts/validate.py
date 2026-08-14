# Does the entry signal actually predict anything, or is it riding gold's uptrend?
#
# backtest.py answers "what did this strategy return". This answers the harder
# question: would random entries under identical rules have done just as well?
#
# Four tests:
#   A. Random-entry null      - signal vs random entries, same SL/TP/no-overlap rules
#   B. 26-year daily backtest - does it hold outside the 2024-26 bull run?
#   C. Bootstrap CI           - how much does a 50-trade result actually tell us?
#   D. Buy & hold benchmark   - total return AND risk-adjusted, vs just holding
#
# Requires: pandas, numpy   Run: python3 pine-scripts/validate.py
import json
import urllib.request
import urllib.parse
import numpy as np
import pandas as pd

import backtest as bt

HEADERS = {"User-Agent": "Mozilla/5.0"}
COST = bt.COST_R
TP1_FRAC = bt.TP1_QTY_FRACTION
MAX_HOLD = 2000       # bars; a position still open past this counts as unresolved
NULL_ITERS = 1500
SL, TP1, TP2 = 2.0, 2.5, 5.0   # Gold's settings
RNG = np.random.default_rng(20260807)


def fetch(ticker, period1, period2, interval):
    """Yahoo with an explicit date range — range=max silently downgrades to monthly bars."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
           f"?period1={period1}&period2={period2}&interval={interval}")
    raw = json.loads(urllib.request.urlopen(
        urllib.request.Request(url, headers=HEADERS), timeout=60).read())
    res = raw["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    return pd.DataFrame({
        "time": pd.to_datetime(res["timestamp"], unit="s", utc=True),
        "open": q["open"], "high": q["high"], "low": q["low"], "close": q["close"],
    }).dropna().reset_index(drop=True)


def indicators(df, htf_bars):
    """Same confluence logic as backtest.py, with the HTF filter at htf_bars x the base bar."""
    d = df.copy().reset_index(drop=True)
    d["ema_f"] = d["close"].ewm(span=bt.EMA_FAST_LEN, adjust=False).mean()
    d["ema_s"] = d["close"].ewm(span=bt.EMA_SLOW_LEN, adjust=False).mean()
    d["rsi"] = bt.rsi(d["close"], bt.RSI_LEN)
    ml, ms = bt.macd(d["close"], bt.MACD_FAST, bt.MACD_SLOW, bt.MACD_SIGNAL)
    d["atr"] = bt.atr(d, bt.ATR_LEN)
    d["atr_avg"] = d["atr"].rolling(bt.ATR_AVG_LEN).mean()

    # HTF groups of htf_bars each; take the LAST bar of every group as that group's close,
    # then make the value readable only from the next bar on. Same no-lookahead alignment
    # as backtest.build_htf_trend and as Pine's request.security on historical bars.
    htf_ema = d["close"].iloc[htf_bars - 1::htf_bars].ewm(span=bt.HTF_EMA_LEN, adjust=False).mean()
    htf_ema.index = htf_ema.index + 1
    d["htf_ema"] = htf_ema.reindex(d.index).ffill()

    cu = (d["ema_f"].shift(1) <= d["ema_s"].shift(1)) & (d["ema_f"] > d["ema_s"])
    cd = (d["ema_f"].shift(1) >= d["ema_s"].shift(1)) & (d["ema_f"] < d["ema_s"])
    vol = d["atr"] >= d["atr_avg"] * bt.MIN_ATR_RATIO
    up, dn = d["close"] > d["htf_ema"], d["close"] < d["htf_ema"]

    return {
        "high": d["high"].to_numpy(float), "low": d["low"].to_numpy(float),
        "close": d["close"].to_numpy(float), "atr": d["atr"].to_numpy(float),
        "time": d["time"].to_numpy(),
        "buy": (cu & d["rsi"].between(bt.RSI_BULL_MIN, bt.RSI_BULL_MAX) & (ml > ms) & vol & up).to_numpy(bool),
        "sell": (cd & d["rsi"].between(bt.RSI_BEAR_MIN, bt.RSI_BEAR_MAX) & (ml < ms) & vol & dn).to_numpy(bool),
        "up": up.to_numpy(bool), "dn": dn.to_numpy(bool),
    }


def precompute(data, sl_mult, tp1_rr, tp2_rr, is_long):
    """Outcome of a trade opened at every bar: (exit bar, realized R). NaN = unresolved.

    Precomputing once lets the random-entry null reuse the exact same trade
    mechanics as the strategy, so the only thing that differs is entry timing.
    """
    high, low, close, atrv = data["high"], data["low"], data["close"], data["atr"]
    n = len(close)
    exit_bar = np.full(n, -1, np.int64)
    r_out = np.full(n, np.nan)
    runner = 1.0 - TP1_FRAC
    be_r = (tp1_rr - COST) * TP1_FRAC + (0.0 - COST) * runner
    tp2_r = (tp1_rr - COST) * TP1_FRAC + (tp2_rr - COST) * runner

    for i in range(n):
        a = atrv[i]
        if not np.isfinite(a) or a <= 0:
            continue
        d = a * sl_mult
        e = close[i]
        sl = e - d if is_long else e + d
        t1 = e + d * tp1_rr if is_long else e - d * tp1_rr
        t2 = e + d * tp2_rr if is_long else e - d * tp2_rr
        done = False
        for j in range(i + 1, min(n, i + 1 + MAX_HOLD)):
            if not done:
                if (low[j] <= sl) if is_long else (high[j] >= sl):
                    exit_bar[i], r_out[i] = j, -1.0 - COST; break
                if (high[j] >= t1) if is_long else (low[j] <= t1):
                    done, sl = True, e          # TP1 filled -> stop to breakeven
            else:
                if (low[j] <= sl) if is_long else (high[j] >= sl):
                    exit_bar[i], r_out[i] = j, be_r; break
                if (high[j] >= t2) if is_long else (low[j] <= t2):
                    exit_bar[i], r_out[i] = j, tp2_r; break
    return exit_bar, r_out


def walk(entry_mask, exit_bar, r_out, lo=0, hi=None):
    """Sequential no-overlap walk — one position at a time, same as the strategy."""
    hi = len(r_out) if hi is None else hi
    out, free = [], lo
    for i in range(lo, hi):
        if i < free or not entry_mask[i] or not np.isfinite(r_out[i]):
            continue
        out.append(r_out[i])
        free = exit_bar[i] + 1
    return np.array(out)


def stats(r):
    if len(r) == 0:
        return None
    w, l = r[r > 0], r[r < 0]
    return {"n": int(len(r)), "win": round(float((r > 0).mean() * 100), 1),
            "exp": round(float(r.mean()), 3), "net": round(float(r.sum()), 1),
            "pf": round(float(w.sum() / -l.sum()), 2) if len(l) and l.sum() else None}


def random_null(candidate_mask, exit_bar, r_out, n_target, lo=0, hi=None):
    """Identical mechanics, random entry timing. Returns the distribution of mean R."""
    hi = len(r_out) if hi is None else hi
    eligible = np.where(candidate_mask[lo:hi] & np.isfinite(r_out[lo:hi]))[0] + lo
    if len(eligible) == 0 or n_target == 0:
        return np.array([])
    p = min(1.0, n_target / len(eligible) * 2.2)   # oversample; no-overlap thins it back
    means = np.empty(NULL_ITERS)
    for k in range(NULL_ITERS):
        draw = np.zeros(len(r_out), bool)
        draw[eligible[RNG.random(len(eligible)) < p]] = True
        r = walk(draw, exit_bar, r_out, lo, hi)
        means[k] = r.mean() if len(r) else np.nan
    return means[np.isfinite(means)]


if __name__ == "__main__":
    NOW = int(pd.Timestamp.now("UTC").timestamp())
    print("Loading Gold data (H1 recent + D1 full history)...", flush=True)
    sets = [
        ("H1  2024-26  (4H filter)", indicators(bt.fetch_yahoo("GC=F"), htf_bars=4)),
        ("D1  2000-26  (weekly filter)", indicators(fetch("GC=F", 0, NOW, "1d"), htf_bars=5)),
    ]

    for tag, data in sets:
        eb_l, r_l = precompute(data, SL, TP1, TP2, True)
        eb_s, r_s = precompute(data, SL, TP1, TP2, False)
        n = len(data["close"])
        print(f"\n{'='*74}\n{tag} — {str(data['time'][0])[:10]} to {str(data['time'][-1])[:10]} "
              f"({n} bars)\n{'='*74}")

        long_r = walk(data["buy"], eb_l, r_l)
        print(f"  Strategy LONG   {stats(long_r)}")
        print(f"  Strategy SHORT  {stats(walk(data['sell'], eb_s, r_s))}")

        # A. the signal vs random entries
        actual = long_r.mean()
        for nm, mask in (("random long, anywhere", np.ones(n, bool)),
                         ("random long, only when trend UP", data["up"])):
            nul = random_null(mask, eb_l, r_l, len(long_r))
            p = float((nul >= actual).mean())
            verdict = "signal beats random" if p < 0.05 else "NOT distinguishable from random"
            print(f"  NULL [{nm}]\n"
                  f"       random mean {nul.mean():+.3f}R  5th/95th [{np.percentile(nul,5):+.3f}, "
                  f"{np.percentile(nul,95):+.3f}]   strategy {actual:+.3f}R   p={p:.3f}  -> {verdict}")

        # C. how much does this sample actually tell us
        bs = np.array([RNG.choice(long_r, len(long_r), replace=True).mean() for _ in range(10000)])
        print(f"  Bootstrap 95% CI on LONG expectancy: [{np.percentile(bs,2.5):+.3f}R, "
              f"{np.percentile(bs,97.5):+.3f}R]")

        # D. vs buy & hold, total and risk-adjusted
        one_r = float(np.nanmedian(data["atr"]) * SL)
        bars_in, free = 0, 0
        for i in range(n):
            if i < free or not data["buy"][i] or not np.isfinite(r_l[i]):
                continue
            bars_in += eb_l[i] - i; free = eb_l[i] + 1
        eq = np.concatenate(([0.], np.cumsum(long_r)))
        s_dd = float((eq - np.maximum.accumulate(eq)).min())
        bh = (data["close"] - data["close"][0]) / one_r
        bh_dd = float((bh - np.maximum.accumulate(bh)).min())
        print(f"  STRATEGY   net {long_r.sum():+7.1f}R | maxDD {s_dd:7.1f}R | "
              f"return/DD {abs(long_r.sum()/s_dd):5.2f} | in market {bars_in/n*100:4.1f}%")
        print(f"  BUY & HOLD net {bh[-1]:+7.1f}R | maxDD {bh_dd:7.1f}R | "
              f"return/DD {abs(bh[-1]/bh_dd):5.2f} | in market 100.0%")

    # B. regime breakdown on the long history
    print(f"\n{'='*74}\nREGIME BREAKDOWN — D1 Gold long trades\n{'='*74}")
    data = sets[1][1]
    eb_l, r_l = precompute(data, SL, TP1, TP2, True)
    times = pd.to_datetime(data["time"])
    for y0, y1, note in [(2000, 2007, "early bull"), (2008, 2011, "GFC + peak"),
                         (2012, 2015, "crash + bear"), (2016, 2019, "sideways"),
                         (2020, 2023, "covid + chop"), (2024, 2026, "recent bull")]:
        lo = int(np.searchsorted(times, pd.Timestamp(f"{y0}-01-01", tz="UTC")))
        hi = int(np.searchsorted(times, pd.Timestamp(f"{y1}-12-31", tz="UTC")))
        s = stats(walk(data["buy"], eb_l, r_l, lo, hi))
        line = (f"{s['n']:>3} trades · win {s['win']:>5.1f}% · exp {s['exp']:+.3f}R · net {s['net']:+6.1f}R"
                if s else "no trades")
        print(f"  {y0}-{y1}  {note:<14} {line}")
