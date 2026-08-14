# Profit-Hunter — Claude Code guide

Do alag cheezein ek hi repo me hain:

- **`pine-scripts/`** — Trend Anchor trading tools (TradingView indicator + Python backtest).
  Zyadatar kaam yahi hota hai.
- **root (`client/`, `server/`, `drizzle/`)** — ek purana React + tRPC web app jo chart
  screenshot AI se analyse karta tha. Trading tools se iska koi connection nahi. Isse mat
  chhedo jab tak user specifically na kahe.

---

## Trend Anchor — ye kya hai

Gold / Silver / Oil ke liye ek trend-following strategy, H1 charts par:

- **Entry**: EMA 9/21 cross + RSI zone + MACD confirm + ATR volatility filter,
  aur sabse zaroori — **4H trend filter** (bada trend saath ho tabhi trade)
- **Stop**: 2.0 × ATR
- **Exit**: TP1 par 1:2.5 (50% book) → stop breakeven par → TP2 par 1:5 (baaki 50%)
- **Sirf long side** — shorts har test me paisa khaate mile

### Files

| File | Kya hai |
|---|---|
| `pine-scripts/trend-anchor-signals.pine` | **Main indicator.** TradingView par ye lagta hai — signals + Entry/SL/TP lines + info panel + alerts |
| `pine-scripts/trend-anchor-strategy.pine` | TradingView Strategy Tester version |
| `pine-scripts/trend-anchor-legacy-indicator.pine` | Purana simple version (arrows + score table) |
| `pine-scripts/backtest.py` | 2-saal ka backtest, Gold/Silver/UKOil |
| `pine-scripts/validate.py` | Reality check — signal random entries se behtar hai ya nahi |
| `pine-scripts/README.md` | Poora documentation, sab numbers ke saath |

---

## Setup

```bash
pip install pandas numpy
```

Bas itna. Data Yahoo Finance se apne aap download hota hai, koi API key nahi chahiye.
Internet chahiye.

## Commands

```bash
python3 pine-scripts/backtest.py    # 2-saal ka backtest, teeno instruments
python3 pine-scripts/validate.py    # null test + 26-saal daily + regime breakdown (slow, ~2-3 min)
```

Slash commands bhi hain — `/backtest`, `/validate`, `/chart`, `/tune`.

---

## Ye baatein pehle se pata hain

Ye sab test ho chuka hai. User poochhe to yahan se jawab do — **lekin numbers hamesha
"8 Aug 2026 ke run par" bolke dena**, kyunki ye stable nahi hain (neeche dekho).

**Gold ke numbers** (H1, 15 Mar 2024 – 7 Aug 2026, longs only, cost ke baad — run 8 Aug 2026):
63 trades · 38.1% win · PF 1.80 · +0.521R expectancy · net +32.85R · maxDD −11.55R

> 🔴 **Numbers reproduce nahi hote — ye khud sabse important finding hai.**
> 7 Aug 2026 ko yahi code, yahi date range, 73 trades / 42.5% / PF 2.15 / +0.693R / +50.6R
> de raha tha. Ek din baad wahi code 63 trades / 38.1% / +0.521R deta hai. Code me koi
> badlaav nahi — Yahoo ne GC=F ka hourly data revise kiya. Start date 1400 bars tak trim
> karke bhi +0.693R kisi window par wapas nahi aata (range sirf +0.417R .. +0.521R).
> **Isliye backtest chalane se mana mat karo — puraane number quote karne se pehle re-run
> karo.**

**Kya kaam karta hai:**
- TP1 par 50% book + stop breakeven — isi se trade TP1 ke baad kabhi loss me nahi jaata.
  Distribution: 61.9% stop-out (−1.05R) · 9.5% breakeven (+1.20R) · 28.6% TP2 (+3.70R).
  Avg win +3.08R vs avg loss −1.05R.
- Longs only
- **4H trend filter — ON rakho, par "asli edge" mat kehna.** Purana dawa (80% vs 36%
  settings OOS-profitable) ab reproduce nahi hota. 8 Aug ke re-test me: full sample par
  filter ON expectancy +0.521R / net +32.85R / DD −11.55R vs OFF +0.517R / **+48.10R** /
  **−7.55R** — yaani OFF behtar. Uska ek hi bacha fayda: parameter robustness, grid ki
  42/45 (93%) settings OOS profitable vs bina filter 35/45 (78%), median OOS +0.306R vs
  +0.293R. Do metrics ulat keh rahe hain → farak zyadatar noise hai.

**Kya kaam nahi karta:**
- **Shorts** — H1 par −0.04R (48 trades), 26-saal daily par −0.354R (23 trades)
- **Silver aur UKOil** — Silver ab sirf +0.039R (1R ~21 cents, aur 2-cent spread ka cost
  0.095R — yaani edge se 2x zyada). UKOil ab **negative**: −0.007R, maxDD −15.3R.
  **Sirf Gold trade karo.**

**Sabse zaroori honesty:** `validate.py` ne check kiya ki agar entry ka time *random* kar
dein to kya hota hai — 26-saal daily par random entries ne **+0.586R** diya, strategy ne
+0.539R (p=0.59). H1 par random +0.288R vs strategy +0.521R (p=0.12) — statistically alag
nahi. Gold H1 ka bootstrap 95% CI **[−0.002R, +1.053R]** hai, yaani zero bhi include karta
hai. **Entry signal ne random se behtar performance kabhi prove nahi ki.** Jo asal me kaam
kar raha hai wo hai ATR stop, partial booking, breakeven, aur ~57% waqt market se bahar
rehna. Ye **risk-control system hai, prediction system nahi** — user ko yahi batana, chahe
numbers kitne bhi acche dikhein.

Buy & hold se comparison: H1 par B&H +80.8R (maxDD −58.7R, return/DD 1.38) vs strategy
+32.9R (maxDD −11.6R, return/DD **2.84**). Fayda return ka nahi, drawdown ka hai.

Test period (2024-26) Gold ka strong bull run tha. Alag market me ye numbers repeat nahi honge.

---

## Kaam karte waqt dhyan rakhna

- **Cost hamesha include karo.** `backtest.py` me `COST_R` hai (default 0.05 = stop distance
  ka 5%). Zero-cost numbers dene se bacho — wo asli se behtar dikhte hain.
- **Naya parameter tune karo to out-of-sample par verify karo** — pehle 60% bars par choose
  karo, baaki 40% par test. In-sample best number bharosemand nahi hota: 8 Aug ke 45-setting
  grid me train-best (SL 2.5 / TP1 2.5 / TP2 3.0) train par +0.647R tha par test par
  +0.537R — aur shipped default (2.0/2.5/5.0) test par +0.497R. Train-best se default
  behtar nahi nikla.
- **Sample size batao.** Gold ka OOS sample sirf 32 trades ka hai, full sample 63. Bootstrap
  CI zero include karta hai. Chhote sample par bade dawe mat karo.
- **Position sizing me lot quantization yaad rakhna.** XAUUSD ka minimum 0.01 lot = 1 ounce,
  aur Gold ka 1R ~$22 hai — matlab $1000 account par 1% risk possible hi nahi (majboori se
  ~2.2% lena padta hai). $2,500 se neeche account par proper risk control nahi hota.
- **Pine code yahan compile nahi hota.** Change karne ke baad user ko batana ki TradingView
  me paste karke verify karein, aur compile error aaye to bhejein.
- Python me `~bool` mat likhna boolean Series ke saath — `~True` Python me `-2` hai jise
  pandas `True` bana deta hai. Ye bug ek baar HTF filter ko chupke se disable kar chuka hai.

## Language

User Hinglish me baat karta hai — usi me jawab do. Numbers aur technical terms English me
theek hain (expectancy, drawdown, profit factor).
