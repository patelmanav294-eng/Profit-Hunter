# Backtest for "Inverse Fair Value Gap v2.0.6 [Manav]".
#
# Ports the Pine indicator's logic to Python so the setup can be measured:
#   FVG -> violation -> IFVG flip -> 1-7 star score -> retest entry
#   Entry = proximal zone edge, SL = far edge + buffer x ATR, TP = R:R multiple.
#
# Requires: pandas, numpy   Run: python3 pine-scripts/ifvg_backtest.py
import json
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

HEADERS = {"User-Agent": "Mozilla/5.0"}

# ---- Pine input defaults (v2.0.6) ----
MIN_SIZE_ATR = 0.30       # Min FVG Size (ATR x)
SIZE_LARGE_ATR = 0.50     # * L
SIZE_HUGE_ATR = 1.00      # * H
IMPULSE_RATIO = 0.60      # * I
DISPLACE_ATR = 0.30       # * D
USE_VOLUME = False        # * V  (off for XAUUSD - tick volume)
VOLUME_THRESHOLD = 1.5
USE_SWEEP = True          # * S
SWING_LEN = 5
SWING_TRACK = 5
SWEEP_LOOKBACK = 10
MIN_STRENGTH = 4
PEND_MAX_AGE = 100        # Max FVG Watch Age (bars)
MAX_IFVG_AGE = 200        # Max IFVG Age (bars)
MITIGATION = "CE"         # "TOUCH" | "CLOSE" | "CE"
ENTRY_TRIGGER = "WICK"    # "WICK" | "CLOSE"
SL_BUFFER_ATR = 0.30      # Risk Tools: SL beyond far edge
RR_TARGET = 4.0           # Risk Tools: TP at this R
COST_R = 0.05             # round-trip spread+slippage as a fraction of 1R
MAX_HOLD = 2000           # bars before an unresolved trade is dropped


def fetch(ticker="GC=F", rng="730d", interval="60m"):
    """Last 2 years of bars. 730d is also Yahoo's limit for hourly data."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
           f"?range={rng}&interval={interval}")
    raw = json.loads(urllib.request.urlopen(
        urllib.request.Request(url, headers=HEADERS), timeout=60).read())
    res = raw["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    df = pd.DataFrame({
        "time": pd.to_datetime(res["timestamp"], unit="s", utc=True),
        "open": q["open"], "high": q["high"], "low": q["low"],
        "close": q["close"], "volume": q.get("volume"),
    }).dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    return df


def resample(df, rule):
    """Build a higher timeframe from the base bars (e.g. '4h')."""
    out = (df.set_index("time")
             .resample(rule, label="right", closed="right")
             .agg({"open": "first", "high": "max", "low": "min",
                   "close": "last", "volume": "sum"})
             .dropna().reset_index())
    return out


def rma(values, length):
    """Wilder smoothing - what Pine's ta.atr / ta.rsi use."""
    out = np.full(len(values), np.nan)
    if len(values) < length:
        return out
    out[length - 1] = values[:length].mean()
    a = 1.0 / length
    for i in range(length, len(values)):
        out[i] = a * values[i] + (1 - a) * out[i - 1]
    return out


def atr(df, length=14):
    h, l, c = df["high"].to_numpy(float), df["low"].to_numpy(float), df["close"].to_numpy(float)
    pc = np.concatenate(([np.nan], c[:-1]))
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    tr[0] = h[0] - l[0]
    return rma(tr, length)


def sweep_flags(df, swing_len, track, lookback):
    """Rejection-based liquidity sweeps: wick past a swing level, close back inside.

    Mirrors the Pine block - levels are consumed once breached either way.
    """
    h, l, c = df["high"].to_numpy(float), df["low"].to_numpy(float), df["close"].to_numpy(float)
    n = len(df)
    since_high = np.full(n, 10 ** 6)
    since_low = np.full(n, 10 ** 6)
    highs, lows = [], []
    sh_count, sl_count = 10 ** 6, 10 ** 6

    for i in range(n):
        # pivot confirmed swing_len bars back (ta.pivothigh(len, len))
        p = i - swing_len
        if p - swing_len >= 0 and p + swing_len < n:
            seg_h = h[p - swing_len:p + swing_len + 1]
            if h[p] == seg_h.max() and (seg_h == h[p]).sum() == 1:
                highs.append(h[p])
                if len(highs) > track:
                    highs.pop(0)
            seg_l = l[p - swing_len:p + swing_len + 1]
            if l[p] == seg_l.min() and (seg_l == l[p]).sum() == 1:
                lows.append(l[p])
                if len(lows) > track:
                    lows.pop(0)

        swept_h = swept_l = False
        for k in range(len(highs) - 1, -1, -1):
            if h[i] > highs[k]:
                if c[i] < highs[k]:
                    swept_h = True
                highs.pop(k)
        for k in range(len(lows) - 1, -1, -1):
            if l[i] < lows[k]:
                if c[i] > lows[k]:
                    swept_l = True
                lows.pop(k)

        sh_count = 0 if swept_h else sh_count + 1
        sl_count = 0 if swept_l else sl_count + 1
        since_high[i] = sh_count
        since_low[i] = sl_count

    return since_high, since_low, lookback


def find_ifvgs(df, htf_up=None, use_htf=False, min_size_atr=MIN_SIZE_ATR):
    """Detect every FVG -> IFVG conversion and score the break candle.

    Returns one record per conversion (including weak ones, so strength can be
    analysed rather than assumed).
    """
    o = df["open"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    v = df["volume"].to_numpy(float) if "volume" in df else np.zeros(len(df))
    a = atr(df, 14)
    a1 = np.concatenate(([np.nan], a[:-1]))          # Pine's atrValue[1]
    vol_sma = pd.Series(v).rolling(20).mean().to_numpy()
    vol_base = np.concatenate(([np.nan], vol_sma[:-1]))
    since_h, since_l, lookback = sweep_flags(df, SWING_LEN, SWING_TRACK, SWEEP_LOOKBACK)

    huge_effective = max(SIZE_LARGE_ATR, SIZE_HUGE_ATR)
    h_available = SIZE_HUGE_ATR > SIZE_LARGE_ATR
    max_stars = 4 + (1 if h_available else 0) + (1 if USE_VOLUME else 0) + (1 if USE_SWEEP else 0)

    pend = []       # dicts: top, bot, bar, is_bull
    out = []

    for i in range(len(df)):
        # ---- violation scan first (a pending FVG can flip on this bar) ----
        for k in range(len(pend) - 1, -1, -1):
            p = pend[k]
            if p["bar"] >= i:
                continue
            violated = (c[i] < p["bot"]) if p["is_bull"] else (c[i] > p["top"])
            if violated:
                ifvg_bull = not p["is_bull"]
                rng = h[i] - l[i]
                body = abs(c[i] - o[i])
                body_ratio = body / rng if rng > 0 else 0.0
                rng_atr = rng / a1[i] if a1[i] and a1[i] > 0 else 0.0
                disp = (p["bot"] - c[i]) if p["is_bull"] else (c[i] - p["top"])
                disp_atr = disp / a1[i] if a1[i] and a1[i] > 0 else 0.0

                fL = rng_atr >= SIZE_LARGE_ATR
                fH = h_available and rng_atr >= huge_effective
                fI = body_ratio >= IMPULSE_RATIO and ((c[i] < o[i]) if p["is_bull"] else (c[i] > o[i]))
                fD = disp_atr >= DISPLACE_ATR
                fV = (USE_VOLUME and not np.isnan(vol_base[i]) and vol_base[i] > 0
                      and v[i] > vol_base[i] * VOLUME_THRESHOLD)
                fS = USE_SWEEP and ((since_l[i] <= lookback) if ifvg_bull else (since_h[i] <= lookback))
                strength = 1 + sum([fL, fH, fI, fD, fV, fS])

                htf_ok = True
                if use_htf and htf_up is not None:
                    htf_ok = bool(htf_up[i]) if ifvg_bull else (not bool(htf_up[i]))

                out.append({
                    "bar": i, "top": p["top"], "bot": p["bot"], "is_bull": ifvg_bull,
                    "strength": strength, "max_stars": max_stars,
                    "L": fL, "H": fH, "I": fI, "D": fD, "V": fV, "S": fS,
                    "htf_ok": htf_ok, "atr": a[i],
                    "factors": "".join([x for x, f in
                                        zip("LHIDVS", [fL, fH, fI, fD, fV, fS]) if f]),
                })
                pend.pop(k)
            elif (i - p["bar"]) > PEND_MAX_AGE:
                pend.pop(k)

        # ---- new FVG detection (3-candle imbalance) ----
        if i >= 2 and not np.isnan(a1[i]) and a1[i] > 0:
            if l[i] > h[i - 2]:
                if (l[i] - h[i - 2]) / a1[i] >= min_size_atr:
                    pend.append({"top": l[i], "bot": h[i - 2], "bar": i - 1, "is_bull": True})
            if h[i] < l[i - 2]:
                if (l[i - 2] - h[i]) / a1[i] >= min_size_atr:
                    pend.append({"top": l[i - 2], "bot": h[i], "bar": i - 1, "is_bull": False})

    return out, a


def simulate_trades(df, zones, sl_buffer=SL_BUFFER_ATR, rr=RR_TARGET,
                    min_strength=MIN_STRENGTH, entry_trigger=ENTRY_TRIGGER,
                    mitigation=MITIGATION, cost_r=COST_R, use_htf=False,
                    max_age=MAX_IFVG_AGE):
    """Retest entry at the proximal edge; SL beyond the far edge; TP at rr x risk.

    One record per zone that actually triggered, with its factors attached so
    win rate can be sliced by pattern afterwards.
    """
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    n = len(df)
    trades = []

    for z in zones:
        if z["strength"] < min_strength:
            continue
        if use_htf and not z["htf_ok"]:
            continue

        top, bot, bull = z["top"], z["bot"], z["is_bull"]
        ce = (top + bot) / 2.0
        entry = top if bull else bot
        a = z["atr"]
        if not np.isfinite(a) or a <= 0:
            continue
        sl = (bot - sl_buffer * a) if bull else (top + sl_buffer * a)
        risk = abs(entry - sl)
        if risk <= 0:
            continue
        tp = entry + rr * risk if bull else entry - rr * risk

        # ---- wait for the retest ----
        start = z["bar"] + 1
        hit = None
        for j in range(start, min(n, start + max_age)):
            if mitigation == "CE":
                dead = (l[j] <= ce) if bull else (h[j] >= ce)
            elif mitigation == "CLOSE":
                dead = (c[j] < bot) if bull else (c[j] > top)
            else:
                dead = (l[j] <= top) if bull else (h[j] >= bot)

            if entry_trigger == "CLOSE":
                touched = bot <= c[j] <= top
            else:
                touched = (l[j] <= top) and (h[j] >= bot)

            if touched:
                hit = j
                break
            if dead:      # zone consumed without ever triggering an entry
                break
        if hit is None:
            continue

        # ---- manage the position from the entry bar onward ----
        result = None
        for j in range(hit, min(n, hit + MAX_HOLD)):
            hit_sl = (l[j] <= sl) if bull else (h[j] >= sl)
            hit_tp = (h[j] >= tp) if bull else (l[j] <= tp)
            if hit_sl:                      # conservative: SL wins same-bar ties
                result = -1.0 - cost_r
                break
            if hit_tp:
                result = rr - cost_r
                break
            if j - hit > max_age:
                break
        if result is None:
            continue

        trades.append({**z, "entry_bar": hit, "r": result,
                       "entry": entry, "sl": sl, "tp": tp, "risk": risk})
    return trades


def stats(trades):
    if not trades:
        return None
    r = np.array([t["r"] for t in trades])
    w, ls = r[r > 0], r[r < 0]
    eq = np.concatenate(([0.0], np.cumsum(r)))
    dd = float((eq - np.maximum.accumulate(eq)).min())
    return {
        "n": len(r),
        "win": round(float((r > 0).mean() * 100), 1),
        "exp": round(float(r.mean()), 3),
        "net": round(float(r.sum()), 1),
        "pf": round(float(w.sum() / -ls.sum()), 2) if len(ls) and ls.sum() else None,
        "dd": round(dd, 1),
    }


def fmt(s):
    if not s:
        return "no trades"
    return (f"{s['n']:>4} trades · win {s['win']:>5.1f}% · exp {s['exp']:>+7.3f}R · "
            f"PF {str(s['pf']):>5} · net {s['net']:>+7.1f}R · maxDD {s['dd']:>6.1f}R")


def htf_trend(base_h1, rule="4h", ema_len=50):
    """4H EMA(50) trend aligned back to the base bars, closed HTF bars only."""
    htf = resample(base_h1, rule)
    ema = htf["close"].ewm(span=ema_len, adjust=False).mean().shift(1)
    s = pd.Series(ema.to_numpy(), index=htf["time"])
    aligned = s.reindex(base_h1["time"], method="ffill").to_numpy()
    return base_h1["close"].to_numpy(float) > aligned


def slice_trades(trades, bull_only=False, need_impulse=False):
    out = trades
    if bull_only:
        out = [t for t in out if t["is_bull"]]
    if need_impulse:
        out = [t for t in out if t["I"]]
    return out


if __name__ == "__main__":
    base = fetch()
    hu = htf_trend(base)
    zones, _ = find_ifvgs(base, htf_up=hu, use_htf=True)
    split = int(len(base) * 0.6)
    print(f"Data: {base['time'].iloc[0].date()} -> {base['time'].iloc[-1].date()} "
          f"({len(base)} H1 bars, {len(zones)} IFVG conversions)")
    print(f"Train/test split at {base['time'].iloc[split].date()}\n")

    # Each row is scored on the unseen half only - the in-sample number of any
    # of these can be made to look good by tuning, so it is not the test.
    configs = [
        ("Pine defaults (SL 0.3, RR 1:4)",      dict(sl=0.3, rr=4.0, bull=False, imp=False, htf=False)),
        ("Wider stop (SL 0.8, RR 1:4)",         dict(sl=0.8, rr=4.0, bull=False, imp=False, htf=False)),
        ("+ Bullish IFVG only",                 dict(sl=0.8, rr=4.0, bull=True,  imp=False, htf=False)),
        ("+ Impulse (I) required",              dict(sl=0.8, rr=4.0, bull=True,  imp=True,  htf=False)),
        ("+ HTF trend filter  <= recommended",  dict(sl=0.8, rr=4.0, bull=True,  imp=True,  htf=True)),
    ]
    print(f"  {'Setup':<38}{'TRAIN exp':>11}{'TEST exp':>11}{'TEST n':>8}{'TEST PF':>9}")
    for label, cfg in configs:
        tr = simulate_trades(base, zones, sl_buffer=cfg["sl"], rr=cfg["rr"], use_htf=cfg["htf"])
        tr = slice_trades(tr, cfg["bull"], cfg["imp"])
        a = stats([t for t in tr if t["entry_bar"] < split])
        b = stats([t for t in tr if t["entry_bar"] >= split])
        if not a or not b:
            print(f"  {label:<38}{'too few trades':>39}")
            continue
        print(f"  {label:<38}{a['exp']:>+11.3f}{b['exp']:>+11.3f}{b['n']:>8}{str(b['pf']):>9}")

    tr = slice_trades(simulate_trades(base, zones, sl_buffer=0.8, rr=4.0, use_htf=True), True, True)
    print(f"\n  Recommended setup, full period:\n    {fmt(stats(tr))}")
