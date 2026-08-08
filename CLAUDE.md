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

## Ye baatein pehle se pata hain — dobara mat nikalna

Ye sab already test ho chuka hai. User poochhe to yahan se jawab do, phir se backtest
mat chalao jab tak wo naya kuch na maange.

**Gold ke numbers** (H1, 2 saal, longs only, cost ke baad):
73 trades · 42.5% win · PF 2.15 · +0.693R expectancy · net +50.6R · maxDD −10.05R

**Kya kaam karta hai:**
- **4H trend filter hi asli edge hai.** Uske saath Gold ki 80% aur Silver ki 100% settings
  unseen data par profitable rahi; uske bina sirf 36% aur 38%. **Kabhi OFF mat karna.**
- TP1 par 50% book + stop breakeven — isi se trade TP1 ke baad kabhi loss me nahi jaata
- Longs only

**Kya kaam nahi karta:**
- **Shorts** — H1 par −0.08R, 26-saal daily par −0.354R
- **Silver aur UKOil** — Silver ka 1R sirf ~21 cents hai, aur 2-cent spread hi uska
  +0.131R edge kha jaata hai. UKOil par +0.017R ke saamne −23.7R drawdown.
  **Sirf Gold trade karo.**

**Sabse zaroori honesty:** `validate.py` ne 26 saal ke daily data par check kiya ki agar
entry ka time *random* kar dein to kya hota hai — random entries ne +0.587R diya, strategy
ne +0.539R. **Yaani lambe arse me entry signal ne random se behtar performance prove nahi
ki.** Jo asal me kaam kar raha hai wo hai ATR stop, partial booking, breakeven, aur 2/3
waqt market se bahar rehna. Ye **risk-control system hai, prediction system nahi** — aur
user ko yahi batana, chahe numbers kitne bhi acche dikhein.

Test period (2024-26) Gold ka strong bull run tha. Alag market me ye numbers repeat nahi honge.

---

## Kaam karte waqt dhyan rakhna

- **Cost hamesha include karo.** `backtest.py` me `COST_R` hai (default 0.05 = stop distance
  ka 5%). Zero-cost numbers dene se bacho — wo asli se behtar dikhte hain.
- **Naya parameter tune karo to out-of-sample par verify karo** — pehle 60% bars par choose
  karo, baaki 40% par test. In-sample best number bharosemand nahi hota: ek grid me 42 me se
  sirf 6 settings unseen data par profitable rahi.
- **Sample size batao.** Gold ka unseen-data sample sirf 49 trades ka hai. Chhote sample par
  bade dawe mat karo.
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
