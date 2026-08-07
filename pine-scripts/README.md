# Profit Hunter — Gold / Silver / UKOil Signal Indicator

Simple TradingView Pine Script indicator, sirf teen instruments ke liye banaya gaya he:
**Gold (XAUUSD), Silver (XAGUSD), UKOil / Brent Crude (UKOIL, ya USOIL/WTI agar tumhara broker wahi deta he)**.

Chaar files hain:

- `profit-hunter-gold-silver-oil-signal.pine` — **Indicator**. Chart pe Buy/Sell signal aur confluence score table dikhata he, alerts ke liye.
- `profit-hunter-gold-silver-oil-strategy.pine` — **Strategy**. Same logic, lekin TradingView ke built-in Strategy Tester se jud jaata he.
- `backtest.py` — **Standalone Python backtest**. TradingView khole bina, terminal se hi backtest chala sakte ho.
- `validate.py` — **Reality check**. Poochta he ki entry signal random entries se behtar hai ya nahi, 26 saal ke data par. Sabse zaroori file — "Kya ye edge asli hai?" section dekho.

**Agar sirf ek cheez padhni ho:** ye ek *risk-control* system hai, *prediction* system nahi. Entry signal ne 26 saal par random entries se behtar performance prove nahi ki. Jo kaam kar raha hai wo hai ATR stops, partial exits, aur 2/3 waqt market se bahar rehna.

Har chart pe alag se lagao — indicator khud symbol detect kar leta hai, koi extra setup nahi chahiye.

## Logic (kyun signal accurate feel hota he)

Signal tabhi fire hota he jab niche wale sab confirm karein (sirf ek indicator pe blind bharosa nahi):

1. **Trend** — Fast EMA (9) ka Slow EMA (21) ke upar/niche cross hona
2. **Momentum** — RSI ek healthy zone me ho (overbought/oversold extremes avoid)
3. **MACD** — MACD line signal line ke sath direction confirm kare
4. **Volatility filter** — ATR check karta he market dead/choppy to nahi he
5. **Higher Timeframe filter** (optional, default ON) — bigger timeframe (4H) ka trend bhi same direction me ho

Jitne zyada in 5 me se true hote hain, utna clean setup — yahi **Confluence Score (0-5)** top-right table me dikhta he.

## Install kaise kare (TradingView)

1. TradingView chart kholo (Gold/Silver/UKOil me se koi bhi)
2. Neeche **Pine Editor** tab kholo
3. Yaha `profit-hunter-gold-silver-oil-signal.pine` file ka pura code copy-paste karo
4. **Add to Chart** dabao
5. Same indicator ko baaki do charts (Gold/Silver/UKOil) pe bhi add kar do

## Teeno me compare kaise karo ki "kis me sahi kaam kar raha he"

Har chart ke top-right corner me table dikhega:

| Field | Matlab |
|---|---|
| Trend | UP / DOWN / FLAT |
| RSI | current momentum reading |
| MACD | Bullish / Bearish / Flat |
| Volatility | OK (tradeable) ya Low (choppy, avoid) |
| Score | 0-5, jitna high utna clean setup |

Teeno charts khol ke score compare karo — jis instrument ka score sabse high aur Volatility "OK" ho, wahi abhi sabse "sahi" trade kar raha he.

## Alerts set karna

1. Chart pe right-click → **Add Alert**
2. Condition me indicator select karo → **"Profit Hunter BUY Signal"** ya **"Profit Hunter SELL Signal"**
3. Notification method choose karo (app push / SMS / webhook / email)
4. Har symbol (Gold/Silver/UKOil) ke liye alag alert banao

## Winrate aur R:R kaise pata karo

Indicator khud winrate ya R:R nahi bataata — wo sirf signal dikhata he. Real numbers nikalne ke liye **strategy version** use karo:

1. TradingView Pine Editor me `profit-hunter-gold-silver-oil-strategy.pine` ka code paste karo → **Add to Chart**
2. Neeche **"Strategy Tester"** tab kholo (Pine Editor ke bagal me)
3. **Overview** sub-tab me milega: Net Profit, **Profit Factor**, Max Drawdown
4. **Performance Summary** sub-tab me exact **"Percent Profitable" (= Win Rate)** milega, Avg Win/Avg Loss se **actual R:R** bhi verify kar sakte ho

Risk inputs `Risk Management` group me hain — **"Stop Loss = ATR x"**, **"TP1 R:R"**, **"TP2 R:R"**. Defaults Gold ke hisab se set hain (2.0x ATR SL, TP1 1:2.5, TP2 1:5). Silver chart pe lagate waqt inko badalna padega — neeche "Per-instrument verdict" table dekho.

**Zaroori baat:** `Commission %` aur `Slippage` inputs ko apne broker ke actual cost se match karo, warna numbers real trading se behtar dikhenge. Costs kitna farak daalte hain wo "Trading costs" section me he.

### Terminal se backtest (TradingView khole bina)

```bash
pip install pandas numpy
python3 pine-scripts/backtest.py
```

Ye script Yahoo Finance se free hourly data (~2.4 saal) download karke wahi confluence logic (EMA cross + RSI + MACD + ATR filter + 4H trend filter, ATR-based SL, TP1/TP2 + breakeven) Gold (GC=F), Silver (SI=F), aur Brent Crude (BZ=F futures — UKOil ka closest free proxy) pe backtest karta he, har instrument ki apni settings ke sath, aur end me comparison print karta he.

Sab settings file ke top me constants ke roop me hain — indicator lengths, `COST_R` (trading cost), aur `PER_SYMBOL_SETTINGS` (per-instrument SL/TP1/TP2). Wahi change karke re-run kar sakte ho.

## Results (out-of-sample tested, costs included)

**Pehle ek zaroori correction:** is README ke pichhle version me jo bhi numbers the — winrate, R:R sweep, per-instrument settings — wo sab galat the. `backtest.py` me ek bug tha jiski wajah se **4H trend filter kabhi apply hi nahi hota tha**, jabki Pine strategy usse apply karti he. Matlab Python ek alag hi strategy measure kar raha tha. Bug fix ho chuka he aur neeche ke saare numbers dobara nikale gaye hain.

### Sabse bada finding: 4H trend filter hi asli edge he

Filter ON vs OFF, out-of-sample test par (settings sirf pehle 60% data par choose ki, phir baaki 40% *unseen* data par verify ki, 0.05R cost ke sath):

| Instrument | Filter ON — kitne % settings unseen data pe profitable | Filter OFF |
|---|---|---|
| Gold | **80%** (median +0.078R) | 36% (median -0.011R) |
| Silver | **100%** (median +0.143R) | 38% (median -0.016R) |
| UKOil | 0% (median -0.223R) | 7% (median -0.133R) |

Filter ke bina strategy dono taraf breakeven ya negative he. Isliye `HTF Trend Filter` ko **kabhi OFF mat karo**.

### Per-instrument verdict

| Instrument | SL = ATR x | TP1 R:R | TP2 R:R | Unseen-data expectancy | Verdict |
|---|---|---|---|---|---|
| **Gold (XAUUSD)** | 2.0 | 2.5 | 5.0 | +0.292R (49 trades) | Sabse strong |
| **Silver (XAGUSD)** | 1.0 | 2.0 | 3.0 | +0.115R (82 trades) | Grid me robust, **lekin spread kha jaata he** — neeche dekho |
| **UKOil (Brent)** | — | — | — | -0.357R (87 trades) | **Mat trade karo** |

**UKOil is strategy ke liye kaam nahi karta.** 45 me se ek bhi setting unseen data par profitable nahi rahi. `backtest.py` me wo sirf isliye rakha he taaki comparison me dikhta rahe ki kyu avoid karna he.

Silver grid ke hisab se sabse consistent he (har tested setting unseen data par profitable), lekin real spread lagane ke baad practically trade karne layak nahi rehta — agla section dekho.

### Trading costs

Costs pehle model hi nahi hote the. Ab `backtest.py` me `COST_R` he (default 0.05 = stop distance ka 5%, har exit par charge hota he). Cost sensitivity:

| Cost per exit | Gold | Silver |
|---|---|---|
| 0.00R | +0.301R | +0.109R |
| 0.05R (default) | +0.251R | +0.059R |
| 0.10R | +0.201R | +0.009R |
| 0.15R | +0.151R | -0.041R |

Gold high costs bhi jhel leta he. **Silver 0.10R se upar break ho jaata he.**

Ab ise asli price units me convert karo — yahi decisive hai:

| | 1R kitna banta he | 2 cent spread | 5 cent spread | Strategy ka edge |
|---|---|---|---|---|
| **Gold** (SL 2.0×ATR) | $22.46 | 0.001R | 0.002R | +0.430R |
| **Silver** (SL 1.0×ATR) | **$0.21** | **0.095R** | **0.238R** | **+0.077R** |

Silver ka stop distance sirf 21 cents hai, isliye **2 cent ka spread bhi uska poora edge kha jaata he** — aur
retail XAGUSD spread aam taur pe 2-4 cents hota he. Gold me 1R $22 ka hai, isliye $0.30-0.50 spread
0.02R se bhi kam padta he.

**Isliye practically: Gold trade karo, Silver skip karo.** `COST_R` ko apne broker ke actual spread se
match karke khud verify kar sakte ho.

## Winrate kam kyu lagta hai (aur kyu chalta hai)

Ye ek trend-following system hai — is type ke systems me **27-40% winrate normal aur expected hota hai**. Chhote losses jaldi cut hote hain, bade winners un losses ko cover karte hain. **Winrate akela dekhna misleading hai — Profit Factor aur Expectancy dekho.** Gold ka winrate sirf ~35-40% he lekin Profit Factor 1.4-1.7 he, kyunki jeetne wale trades kaafi bade hote hain.

## TP1 + TP2 + Breakeven (Cost to Cost) SL

Strategy do targets use karti he, single target ki jagah:

- **TP1** — position ka partial % (default 50%) yahan book hota he, closer target pe
- Jaise hi TP1 hit hota he, baaki 50% ka **Stop Loss entry price (cost-to-cost / breakeven) pe move ho jaata he** — wo hissa risk-free ban jaata he
- **TP2** — baaki 50% yahan tak chalta he (ya breakeven pe scratch ho jaata he agar price wapas aa jaye)

Inputs `Risk Management` group me: `TP1 R:R`, `TP1 Exit Size (%)`, `TP2 R:R`, `TP1 hit hone par SL Breakeven pe move karo`.

Breakeven SL winrate badhata he, lekin TP1 ko bahut paas rakhne se bade winners beech me hi scratch ho jaate hain. Isliye TP1 ko theek-thaak door (1:2 se 1:2.5) rakhna behtar nikla.

## Kya ye edge asli hai? (26 saal ka validation)

`validate.py` sabse zaroori sawaal poochta hai: **agar entry ka time random kar dein, tab kya hota hai?**
Bilkul wahi SL/TP/breakeven rules, wahi one-position-at-a-time niyam — sirf entry random. Agar random
entries bhi utna hi kamaati hain, to signal ki koi keemat nahi.

| Window | Strategy (long) | Random entry (trend UP) | p-value | Verdict |
|---|---|---|---|---|
| H1, 2024-26 (75 trades) | +0.710R | +0.341R | 0.015 | Signal random se aage |
| **D1, 2000-26 (59 trades)** | **+0.539R** | **+0.587R** | **0.599** | **Random se farak nahi** |

**26 saal par entry signal random entries se behtar nahi hai** — balki halka sa kharab. 2024-26 me
signal jeetata hai, lekin us window me random entries ne bhi +0.341R kamaya, yaani strategy ke
+0.710R ka aadha hissa sirf market ka upar jaana hai.

### Regime breakdown (D1 Gold, long trades)

| Period | | Trades | Win | Expectancy |
|---|---|---|---|---|
| 2000-07 | early bull | 23 | 34.8% | +0.167R |
| 2008-11 | GFC + peak | 10 | 50.0% | +1.075R |
| 2012-15 | crash + bear | 4 | 25.0% | **−0.487R** |
| 2016-19 | sideways | 11 | 36.4% | +0.223R |
| 2020-23 | covid + chop | 5 | 60.0% | +0.800R |
| 2024-26 | recent bull | 6 | 66.7% | +2.117R |

Gold bear market (2012-15) me strategy loss me jaati hai. Aur dhyan do — recent bull ka +2.117R
sirf **6 trades** ka hai; wahi poore 26-saal ke result ko upar kheench raha hai.

### Buy & hold se comparison

| Window | Approach | Net | Max DD | Return ÷ DD | Time in market |
|---|---|---|---|---|---|
| H1 2024-26 | Strategy | +53.3R | −11.1R | **4.80** | 35% |
| | Buy & hold | +99.5R | −72.2R | 1.38 | 100% |
| D1 2000-26 | Strategy | +31.8R | −6.2R | **5.17** | 33% |
| | Buy & hold | +141.0R | −45.5R | 3.10 | 100% |

Total return me buy & hold aage hai. **Lekin risk-adjusted me strategy kaafi behtar hai** — H1 par
4.80 vs 1.38 return-per-drawdown, wo bhi sirf 35% time market me. Buy & hold ko −72R drawdown
jhelna padta hai, strategy ko −11R.

### Iska matlab

Ye **prediction system nahi, risk-control system hai.** Entry "smart" nahi hai — jo kaam kar raha
hai wo hai ATR-based stops, partial exits, breakeven, aur 2/3 waqt market se bahar rehna. Isse
gold ke uptrend ka accha hissa mil jaata hai, drawdown ke ek chhote fraction par.

Khud chalane ke liye:

```bash
python3 pine-scripts/validate.py
```

## Kitna bharosa karein in numbers par

Imaandari se: **utna nahi jitna table dekh kar lagta hai.**

- **Entry signal ne 26 saal par koi edge prove nahi kiya.** Ye sabse badi baat hai — upar wala null test dekho.
- Sample chhota hai — Gold ke unseen half par sirf 49 trades, aur D1 par 26 saal me sirf 59 long trades.
- H1 data sirf ~2.4 saal ka hai (Yahoo hourly ki limit), aur wo bhi Gold ke strong bull run ka period.
- Futures data (GC=F / SI=F / BZ=F) hai — tumhare broker ka spot ya CFD feed thoda alag hoga.
- Overnight gaps aur weekend risk model nahi kiye gaye.
- Same bar me SL aur TP dono hit ho jaayein to conservatively SL maana gaya hai.
- Ye numbers kaafi saare configurations test karne ke baad ke best hain — multiple-testing ka effect inme shamil hai.

## Settings tweak karna (optional)

- **`HTF Trend Filter` ko OFF mat karo.** Ye tempting lagta he kyunki OFF karne se signals kaafi zyada aate hain — lekin test me wahi single change Gold ko +0.29R se -0.06R (unseen data par) le jaata he. Kam signals lena hi yahan point he.
- Signals kam lag rahe hain to ye normal he — filter ke sath ~2.4 saal me 114 (Gold) se 217 (Silver) trades aate hain. Zyada trades chahiye to lower timeframe use karo, filter mat hatao.
- `COST_R` (backtest.py me) ko apne broker ke actual spread se match karo — Silver ka edge 0.10R cost se upar khatam ho jaata he.

## Disclaimer

Ye tool sirf decision-support he, guaranteed profit ka promise nahi karta. Risk management (stop loss, position size) khud discipline se follow karo.
