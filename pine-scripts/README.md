# Trend Anchor — Buy/Sell Signal Tool

TradingView indicator jo Gold, Silver aur Oil charts par **BUY/SELL signal** deta hai, aur saath me
**Entry, Stop Loss, TP1 aur TP2 ki exact lines** bhi chart par draw karta hai — taaki signal aate hi
pata ho kahan enter karna hai, kahan stop lagana hai, aur kahan book karna hai.

**Naam kyun "Trend Anchor":** is strategy ka poora edge 4-hour trend filter se aata hai — bada trend
hi wo *anchor* hai jiske saath hi trade liya jaata hai. Testing me uske bina strategy breakeven ya
negative ho jaati hai. Doosra hissa risk structure ka hai: TP1 par aadha book karke stop breakeven
par le aana.

**Jo file chart par lagani hai: `trend-anchor-signals.pine`**

Baaki files sirf verification ke liye hain (neeche "Repo me kya kya hai" dekho).

---

## Install (2 minute)

1. TradingView par apna chart kholo — **XAUUSD**, timeframe **H1** (1 hour)
2. Neeche **Pine Editor** tab kholo
3. `trend-anchor-signals.pine` ka poora code copy-paste karo
4. **Add to Chart** dabao

Bas. Settings symbol ke hisab se apne aap set ho jaati hain — Gold par gold wali, Silver par silver
wali. Kuch manually badalne ki zaroorat nahi.

---

## Signal aane par kya karna hai

Jab chart par **BUY** ka label aayega, uske saath 4 lines dikhengi:

| Line | Rang | Matlab |
|---|---|---|
| Entry | grey | Yahan enter karo |
| Stop Loss | laal | Yahan nikal jao agar galat gaya |
| TP1 | neela | Yahan **aadhi (50%) position book** karo |
| TP2 | hara | Baaki aadhi ka final target |

Top-right ke panel me yahi cheezein numbers me bhi likhi hongi, aur "Ab kya" row batayegi ki agla step kya hai.

**Sabse zaroori rule:** jaise hi price TP1 tak pahunche —

1. **50% position book kar do**
2. **Stop loss ko entry price par le aao** (cost to cost)

Uske baad wo trade risk-free ho jaata hai. Indicator ye khud track karta hai — TP1 lagte hi laal
stop line apne aap entry par shift ho jaayegi aur panel me "Stop breakeven par hai" dikhega.

---

## Phone par alert lagana

1. Chart par right-click → **Add Alert**
2. Condition me **Trend Anchor** select karo
3. Neeche dropdown me **"Any alert() function call"** choose karo
4. Notification me apna app / SMS / email select karo → **Create**

Isse alert me poori detail aayegi, sirf "BUY" nahi:

```
BUY XAUUSD (60)
Entry: 4352.10
Stop Loss: 4307.20
TP1 (50% book): 4464.35
TP2: 4576.60
TP1 lagne par stop ko entry par le aana.
```

Aur jab TP1 lagega, alag alert aayega ki 50% book karo aur stop breakeven par le jao.

---

## Pichhle 2 saal ka backtest

H1 chart, trading cost ke baad (0.05R per exit), **sirf BUY signals** (jaise tool default me hai):

| Instrument | Trades | Win rate | Profit Factor | Expectancy | Net | Max drawdown |
|---|---|---|---|---|---|---|
| **Gold (XAUUSD)** | 63 | **38.1%** | **1.80** | **+0.521R** | +32.85R | −11.55R |
| Silver (XAGUSD) | 123 | 35.0% | 1.06 | +0.039R | +4.85R | −17.4R |
| UKOil (Brent) | 94 | 29.8% | 0.99 | **−0.007R** | −0.7R | −15.3R |

*Period: 15 Mar 2024 – 7 Aug 2026 (run: 8 Aug 2026).*

> ⚠️ **Ye numbers stable nahi hain — inhe hamesha khud re-run karke dekho.**
> 7 Aug 2026 ko yahi code, yahi date range, Gold par **73 trades / 42.5% / +0.693R** de raha tha.
> 8 Aug ko wahi code **63 trades / 38.1% / +0.521R** deta hai. Code me koi badlaav nahi hua —
> Yahoo ne GC=F ka hourly data revise kar diya. Start date 1400 bars tak trim karke bhi
> +0.693R kisi window par wapas nahi aata (range sirf +0.417R se +0.521R).
> Matlab: is repo ka koi bhi number ek snapshot hai, sach nahi.

**1R = stop loss ki doori.** Yaani agar tum har trade par account ka 1% risk karte ho, to Gold ka
+0.521R matlab average **+0.52% per trade**.

### Kaun sa instrument use karo

**Gold sabse behtar hai** — teeno me sirf yahi meaningful positive hai.

**Silver ka number practically kaam nahi karta.** Wajah: Silver ka stop distance sirf
**~21 cents** hota hai, isliye —

| Silver spread | Cost | vs edge (+0.039R) |
|---|---|---|
| 2 cents | 0.095R | **edge se 2x zyada — loss** |
| 5 cents | 0.238R | **edge se 6x zyada — bada loss** |

Retail brokers ka XAGUSD spread aam taur par 2-4 cents hota hai, yaani Silver ka +0.039R edge
spread me hi gayab. Gold me 1R **$22** ka hota hai, isliye $0.30-0.50 ka spread sirf 0.02R
padta hai — bilkul comfortable.

**UKOil skip karo** — expectancy ab **negative** (−0.007R) hai, saath me −15.3R drawdown.

### SELL signals default me band kyun hain

Har test me shorts paisa khaate mile — H1 par −0.04R (48 trades), 26 saal ke daily data par
−0.354R per trade (23 trades).
Chahiye to settings me on kar sakte ho (`Direction → SELL signals dikhao`), lekin backtest support
nahi karta.

---

## Winrate 38% kam lagta hai?

Ye trend-following system hai — inme **30-45% winrate normal hai**. Kyunki jeetne wale trades
haarne walon se **2-3 guna bade** hote hain:

- Average WIN: **+3.08R**
- Average LOSS: **−1.05R**
- Realized R:R: **1 : 2.93**

Har trade me teen me se ek cheez hoti hai (Gold ke 63 trades):

| Kya hua | Kitni baar | Result |
|---|---|---|
| Stop lag gaya, TP1 tak nahi pahuncha | 61.9% (39) | −1.05R |
| TP1 laga, phir breakeven par band | 9.5% (6) | **+1.20R** |
| TP1 laga, phir TP2 tak gaya | 28.6% (18) | **+3.70R** |

Dhyan do — TP1 lag jaane ke baad trade **kabhi loss me nahi jaata**, kyunki aadha position pehle hi
book ho chuka hota hai aur stop breakeven par aa chuka hota hai. Isiliye 50% book karna aur stop
move karna itna zaroori hai.

---

## Do settings jo mat chhedna

**1. HTF Trend Filter — ON hi rakhna (par wajah badal gayi hai).**
Ye 4-hour chart ka trend check karta hai: bada trend upar ho tabhi BUY leta hai.

Purana dawa tha ki iske bina Gold ka expectancy +0.29R se −0.06R ho jaata hai. **Ye ab
reproduce nahi hota.** 8 Aug 2026 ke data par:

| | Filter ON | Filter OFF |
|---|---|---|
| Full sample expectancy | +0.521R | +0.517R |
| Full sample net | +32.85R | **+48.10R** |
| Full sample max DD | −11.55R | **−7.55R** |
| Grid ki settings jo out-of-sample profitable rahi | **42/45 (93%)** | 35/45 (78%) |
| Median out-of-sample expectancy | +0.306R | +0.293R |

Yaani filter expectancy nahi badhata, aur full sample par to net return kam aur drawdown
zyada karta hai. Uska ek hi fayda bacha hai: **parameter choice ke prati robustness** —
filter ke saath grid ki 93% settings unseen data par profitable rahi, bina filter 78%.

Isliye ON rakho (kam se kam ye galat settings se bachaata hai), lekin ise "asli edge"
mat samajhna. Do metrics ek doosre se ulat keh rahe hain — matlab farak zyadatar noise hai.

**2. "Signal sirf candle band hone par confirm karo" — ON hi rakhna.**
Warna chalti hui candle me signal aata-jaata dikhega aur tum galat entry le loge.

---

## Repo me kya kya hai

| File | Kaam |
|---|---|
| **`trend-anchor-signals.pine`** | **Ye chart par lagao.** Signal + Entry/SL/TP lines + panel + alerts |
| `trend-anchor-strategy.pine` | TradingView Strategy Tester version — khud numbers verify karne ke liye |
| `trend-anchor-legacy-indicator.pine` | Purana simple indicator (sirf arrows + score table) |
| `backtest.py` | Terminal se 2-saal ka backtest |
| `validate.py` | Reality check — signal random entries se behtar hai ya nahi |

Backtest khud chalane ke liye:

```bash
pip install pandas numpy
python3 pine-scripts/backtest.py
```

Sab settings `backtest.py` ke top me constants hain — `COST_R` ko apne broker ke actual spread se
match karke re-run kar sakte ho.

---

## Imaandari se: kitna bharosa karein

Ye numbers achhe hain, lekin inko "guaranteed profit" mat samajhna. Jo cheezein tumhe pata honi chahiye:

- **Test period Gold ka strong bull run tha (2024-26).** Us dauran long lena waise bhi kaam karta.
  Alag market me ye numbers repeat nahi honge.
- **Sample chhota hai** — Gold par sirf 63 trades. Bootstrap 95% CI: **[−0.002R, +1.053R]**.
  Yaani is sample se ye bhi nahi keh sakte ki expectancy zero se upar hai.
- **Data khud badalta rehta hai.** Yahoo ka GC=F hourly feed revise hota hai — ek din me hi
  Gold 73 trades / +0.693R se 63 trades / +0.521R par aa gaya, bina code chhue.
- **Lambe test me signal ne edge prove nahi kiya.** `validate.py` ne check kiya ki agar entry ka
  time *random* kar dein to kya hota hai:

  | Test | Random entries | Strategy | p-value | Nateeja |
  |---|---|---|---|---|
  | H1 2024-26 | +0.288R | +0.521R | 0.120 | random se alag nahi |
  | D1 2000-26 (26 saal) | +0.586R | +0.539R | 0.590 | random **behtar** nikla |

  26 saal par random entries ne strategy se *zyada* diya. Entry signal ka koi prove-able
  edge nahi hai.
- **Buy & hold se kam return, lekin behtar risk.** H1 par B&H +80.8R (maxDD −58.7R,
  return/DD 1.38) vs strategy +32.9R (maxDD −11.6R, return/DD **2.84**), aur strategy sirf
  42.6% waqt market me rehti hai. Fayda return ka nahi, drawdown ka hai.
- **Jo cheez asal me kaam kar rahi hai** wo hai ATR-based stop, TP1 par 50% book karna, stop
  breakeven par le jaana, aur 2/3 waqt market se bahar rehna. Ye ek **risk-control system hai,
  prediction system nahi.**
- Data futures ka hai (GC=F/SI=F/BZ=F) — tumhare broker ka spot/CFD feed thoda alag hoga.
- Overnight gaps aur weekend risk model nahi kiye gaye.

**Isliye: pehle 2-3 mahine demo account par chalao.** Live jaane par risk per trade 1% se zyada mat
rakhna — is strategy me 10R ka drawdown normal hai, yaani 10 baar ka risk ek saath doob sakta hai.

Trading me nuksan hota hai. Ye tool decision-support hai, guarantee nahi.
