# Trend Anchor — Desktop par setup

Gold trading tool. Ye file khol ke bas neeche ke steps follow karo.

---

## 1. Ek baar ka setup

Terminal kholo aur:

```bash
git clone -b claude/chat-session-0c1q0i https://github.com/patelmanav294-eng/Profit-Hunter.git
cd Profit-Hunter
bash pine-scripts/setup.sh
```

`setup.sh` Python check karega, pandas/numpy install karega, aur Yahoo Finance se
connection test karega. Agar sab theek hai to Gold ka current price dikhega.

**Python nahi hai?** [python.org/downloads](https://python.org/downloads) se install karo
(Windows par installation ke waqt "Add Python to PATH" tick karna mat bhoolna).

---

## 2. Claude Code CLI se chalana

Usi folder me:

```bash
claude
```

Ab in me se kuch bhi type karo:

| Command | Kya karega |
|---|---|
| `/backtest` | 2-saal ka backtest chalayega aur result Hinglish me samjhayega |
| `/validate` | Reality check — signal random se behtar hai ya nahi (26 saal ka data, slow) |
| `/chart` | Recent signal ko chart par render karke dikhayega |
| `/tune` | Parameters tune karega, lekin out-of-sample verify karke |

Ya seedha baat karo — "gold ka backtest chala do", "chart pe dikha kaisa lagta hai",
"$2000 par 2% risk se kya hota". Claude ko `CLAUDE.md` se sab context mil jaata hai:
strategy kya hai, kya kaam karta hai, kya nahi, aur kaunse bug pehle mil chuke hain.

**Bina Claude ke bhi chal jaayega:**

```bash
python3 pine-scripts/backtest.py
python3 pine-scripts/validate.py
```

---

## 3. TradingView par indicator lagana

1. `pine-scripts/trend-anchor-signals.pine` kholo, poora code copy karo
2. TradingView par **XAUUSD** chart, timeframe **1 hour**
3. Neeche **Pine Editor** tab → default code delete → paste
4. **Add to Chart**

Settings symbol dekh kar apne aap set ho jaayengi.

**Alert lagane ke liye:** chart par right-click → Add Alert → Condition me **Trend Anchor**
→ dropdown me **"Any alert() function call"** → Create. Alert me entry, SL, TP1, TP2 —
sab numbers aayenge.

---

## Trade kaise lena hai

BUY signal aane par chart par 4 lines dikhengi:

| Line | Kya karna |
|---|---|
| **Entry** (grey) | Yahan enter karo |
| **Stop Loss** (laal) | Yahan nikal jao |
| **TP1** (neela) | **50% position book karo** aur **stop entry par le aao** |
| **TP2** (hara) | Baaki 50% ka target |

TP1 lagte hi indicator khud stop line entry par shift kar deta hai, aur alert bhi bhejta hai.
Uske baad wo trade risk-free ho jaata hai.

---

## Ye pata hona chahiye

**Gold ke numbers** (H1, pichhle 2 saal, cost ke baad, longs only):
73 trades · **42.5% win** · PF 2.15 · **+0.693R** per trade · maxDD −10.05R

**Sirf Gold trade karo.** Silver ka stop distance sirf ~21 cents hai — 2-cent ka spread hi
uska poora edge kha jaata hai. UKOil par +0.017R ke saamne −23.7R drawdown.

**Do settings kabhi mat chhedna:**
1. **HTF Trend Filter — ON.** Ye poore setup ka sabse bada edge hai. OFF karne se signals
   zyada aate hain lekin Gold ka expectancy +0.29R se −0.06R ho jaata hai.
2. **"Signal sirf candle band hone par confirm karo" — ON.** Warna chalti candle me signal
   aata-jaata dikhega.

**Account size:** $2,500 se neeche proper risk control possible nahi hai. XAUUSD ka minimum
lot (0.01) = 1 ounce, aur Gold ka 1R ~$22 hai — matlab $1,000 account par majboori se ~2.2%
risk lena padta hai. $1,000 par agar tum disciplined 1% risk par ade raho to 2 saal me sirf
1 trade milega.

**Winrate 42% kam nahi hai** — ye trend-following system hai. Average jeet +2.70R, average
haar −1.05R. Sabse lambi losing streak 10 trades lagatar thi.

---

## Imaandari se

Ye numbers achhe hain lekin guarantee nahi:

- Test period (2024-26) Gold ka **strong bull run** tha. Alag market me repeat nahi honge.
- Sample chhota hai — Gold par 73 trades.
- **26 saal ke daily data par entry signal ne random entries se behtar performance prove
  nahi ki** (random +0.587R, strategy +0.539R). Jo asal me kaam kar raha hai wo hai ATR
  stop, TP1 par partial booking, breakeven, aur 2/3 waqt market se bahar rehna.
  Ye **risk-control system hai, prediction system nahi.**

**Pehle 2-3 mahine demo par chalao.** Live jaane par risk per trade 1-2% se zyada mat rakhna.

Poora documentation: [`pine-scripts/README.md`](pine-scripts/README.md)
