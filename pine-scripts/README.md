# Profit Hunter — Gold / Silver / UKOil Signal Indicator

Simple TradingView Pine Script indicator, sirf teen instruments ke liye banaya gaya he:
**Gold (XAUUSD), Silver (XAGUSD), UKOil / Brent Crude (UKOIL, ya USOIL/WTI agar tumhara broker wahi deta he)**.

Teen files hain:

- `profit-hunter-gold-silver-oil-signal.pine` — **Indicator**. Chart pe Buy/Sell signal aur confluence score table dikhata he, alerts ke liye.
- `profit-hunter-gold-silver-oil-strategy.pine` — **Strategy**. Same logic, lekin TradingView ke built-in Strategy Tester se jud jaata he — isi se tumhe **real historical Win Rate aur R:R** milega (neeche "Winrate aur R:R kaise pata karo" section dekho).
- `backtest.py` — **Standalone Python backtest**. TradingView khole bina, terminal se hi ye same logic ka backtest chala sakte ho — Gold/Silver/UKOil teeno ke liye ek saath. Yahoo Finance se free historical data khud download karta he.

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
| **Silver (XAGUSD)** | 1.0 | 2.0 | 3.0 | +0.115R (82 trades) | Sabse robust (100% settings positive) |
| **UKOil (Brent)** | — | — | — | -0.357R (87 trades) | **Mat trade karo** |

**UKOil is strategy ke liye kaam nahi karta.** 45 me se ek bhi setting unseen data par profitable nahi rahi. `backtest.py` me wo sirf isliye rakha he taaki comparison me dikhta rahe ki kyu avoid karna he.

Silver ko maine pehle "weakest" bola tha — wo bhi bug ki wajah se galat tha. Filter ke sath Silver actually sabse **consistent** instrument he (har tested setting unseen data par profitable), bhale uska per-trade expectancy Gold se kam ho.

### Trading costs

Costs pehle model hi nahi hote the. Ab `backtest.py` me `COST_R` he (default 0.05 = stop distance ka 5%, har exit par charge hota he). Cost sensitivity:

| Cost per exit | Gold | Silver |
|---|---|---|
| 0.00R | +0.301R | +0.109R |
| 0.05R (default) | +0.251R | +0.059R |
| 0.10R | +0.201R | +0.009R |
| 0.15R | +0.151R | -0.041R |

Gold high costs bhi jhel leta he. **Silver 0.10R se upar break ho jaata he** — agar tumhara broker ka Silver spread wide he to Silver ka edge khatam ho jaayega. `COST_R` ko apne broker ke actual spread se match karo.

## Winrate kam kyu lagta hai (aur kyu chalta hai)

Ye ek trend-following system hai — is type ke systems me **27-40% winrate normal aur expected hota hai**. Chhote losses jaldi cut hote hain, bade winners un losses ko cover karte hain. **Winrate akela dekhna misleading hai — Profit Factor aur Expectancy dekho.** Gold ka winrate sirf ~35-40% he lekin Profit Factor 1.4-1.7 he, kyunki jeetne wale trades kaafi bade hote hain.

## TP1 + TP2 + Breakeven (Cost to Cost) SL

Strategy do targets use karti he, single target ki jagah:

- **TP1** — position ka partial % (default 50%) yahan book hota he, closer target pe
- Jaise hi TP1 hit hota he, baaki 50% ka **Stop Loss entry price (cost-to-cost / breakeven) pe move ho jaata he** — wo hissa risk-free ban jaata he
- **TP2** — baaki 50% yahan tak chalta he (ya breakeven pe scratch ho jaata he agar price wapas aa jaye)

Inputs `Risk Management` group me: `TP1 R:R`, `TP1 Exit Size (%)`, `TP2 R:R`, `TP1 hit hone par SL Breakeven pe move karo`.

Breakeven SL winrate badhata he, lekin TP1 ko bahut paas rakhne se bade winners beech me hi scratch ho jaate hain. Isliye TP1 ko theek-thaak door (1:2 se 1:2.5) rakhna behtar nikla.

## Kitna bharosa karein in numbers par

Imaandari se: **utna nahi jitna table dekh ke lagta he.**

- Unseen-data sample chhota he — Gold par sirf 49 trades. Us size par expectancy ka confidence interval kaafi wide he.
- Data sirf ~2.4 saal ka he (Yahoo hourly data ki limit), aur wo bhi Gold/Silver ke ek strong bull run ka period he. Alag market regime me result alag ho sakta he.
- Futures data (GC=F/SI=F/BZ=F) use kiya he — tumhare broker ka spot/CFD feed thoda alag hoga (rollover/basis difference).
- Overnight gaps aur weekend risk model nahi kiye gaye.
- Same bar me SL aur TP dono hit ho jaayein to conservatively SL maana gaya he.

Isko "ye strategy paisa banayegi" ka proof mat samjho. Ye itna kehta he: **Gold aur Silver par filter ke sath ek measurable edge dikha jo unseen data par tika raha; UKOil par nahi dikha.** Live paisa lagane se pehle demo par forward-test karo.

## Settings tweak karna (optional)

- **`HTF Trend Filter` ko OFF mat karo.** Ye tempting lagta he kyunki OFF karne se signals kaafi zyada aate hain — lekin test me wahi single change Gold ko +0.29R se -0.06R (unseen data par) le jaata he. Kam signals lena hi yahan point he.
- Signals kam lag rahe hain to ye normal he — filter ke sath ~2.4 saal me 114 (Gold) se 217 (Silver) trades aate hain. Zyada trades chahiye to lower timeframe use karo, filter mat hatao.
- `COST_R` (backtest.py me) ko apne broker ke actual spread se match karo — Silver ka edge 0.10R cost se upar khatam ho jaata he.

## Disclaimer

Ye tool sirf decision-support he, guaranteed profit ka promise nahi karta. Risk management (stop loss, position size) khud discipline se follow karo.
