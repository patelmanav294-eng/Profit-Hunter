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

R:R input `Risk Management` group me hai — **"Stop Loss = ATR x"** aur **"Risk:Reward Ratio"**. Default 1.5x ATR SL, 1:2 R:R rakha he, tum change karke re-test kar sakte ho (Strategy Tester turant naye numbers dikha dega).

**Zaroori baat:** Ye backtest historical data pe he — future performance ki guarantee nahi deta, especially Gold/Silver/Oil me spread aur slippage real trading me zyada bhi ho sakta he (`Commission %` aur `Slippage` inputs ko apne broker ke actual cost se match karo taaki numbers realistic aayein). Teeno instruments (XAUUSD/XAGUSD/UKOIL) pe alag-alag apply karke compare karo ki kaunsa historically better winrate/R:R deta he — lekin final decision lene se pehle forward-test (demo account) pe bhi check karna better hai.

### Terminal se backtest (TradingView khole bina)

```bash
pip install pandas numpy
python3 pine-scripts/backtest.py
```

Ye script Yahoo Finance se free hourly data (~2+ saal) download karke exact wahi confluence logic (EMA cross + RSI + MACD + ATR filter + 4H trend filter, ATR-based SL, configurable R:R) Gold (GC=F), Silver (SI=F), aur Brent Crude (BZ=F futures — UKOil ka closest free proxy) pe backtest karta he, aur end me teeno ka comparison print karta he (sabse best expectancy wala sabse upar).

Settings (EMA/RSI/MACD/ATR/R:R length, values) file ke top me constants ke roop me hain — Pine strategy ke defaults se match karte hain, wahi change karke re-run kar sakte ho.

Limitations: futures data spot/CFD se thoda different ho sakta he (rollover/basis), aur real spread-commission-slippage include nahi hai — sirf directional edge check karne ke liye he, live capital lagane se pehle demo pe verify zaroor karo.

## Winrate kam kyu lagta hai (aur kyu chalta hai)

Ye ek trend-following system hai (EMA crossover based) — is type ke systems me **30-40% winrate normal aur expected hota hai**. Chhote losses jaldi cut hote hain, aur bade winners un sab losses ko cover kar dete hain. **Winrate akela dekhna misleading hai — Profit Factor aur Expectancy dekho.**

R:R sensitivity sweep (2024-03-15 se 2026-08-07 tak, H1 data, `backtest.py` se):

| R:R | Gold Winrate | Gold Expectancy | Silver Expectancy | UKOil Expectancy |
|---|---|---|---|---|
| 1:1.0 | 47.8% | -0.043R | -0.02R | -0.116R |
| 1:1.5 | 39.5% | -0.013R | -0.02R | -0.032R |
| 1:2.0 | 36.0% | +0.08R | -0.003R | -0.012R |
| 1:2.5 | 30.8% | +0.08R | +0.036R | +0.012R |
| **1:3.0** | **29.1%** | **+0.162R (best)** | 0.0R | +0.026R |

Higher R:R = kam winrate lekin better expectancy (Gold ke liye). Silver aur UKOil kisi bhi single-target R:R pe consistently weak rehte hain — Gold hi is strategy ka strongest instrument hai.

## TP1 + TP2 + Breakeven (Cost to Cost) SL

Strategy ab do targets use karti he, single target ki jagah:

- **TP1** — position ka partial % (default 50%) yahan book hota he, closer target pe
- Jaise hi TP1 hit hota he, baaki 50% ka **Stop Loss entry price (cost-to-cost / breakeven) pe move ho jaata he** — ab wo trade "risk-free" ho jaata he
- **TP2** — baaki 50% yahan tak chalta he (ya breakeven pe scratch ho jaata he agar wapas aa jaye)

Inputs `Risk Management` group me: `TP1 R:R`, `TP1 Exit Size (%)`, `TP2 R:R`, `TP1 hit hone par SL Breakeven pe move karo`.

**Tradeoff jo backtest me mila:** Breakeven SL winrate zaroor badhata he, lekin agar TP1 bahut close rakho to bade winners beech me hi scratch ho jaate hain aur expectancy gir jaati he. TP1 ko thoda door rakhne se (zyada room) dono improve hote hain:

| TP1 R:R (50% qty, TP2 1:3, breakeven ON) | Gold Winrate | Gold Expectancy | UKOil Expectancy |
|---|---|---|---|
| 1:0.5 | 64.8% | +0.024R | -0.087R |
| 1:1.0 | 47.4% | +0.006R | -0.112R |
| **1:2.0 (default)** | **35.9%** | **+0.094R (best)** | **+0.009R** |
| No TP1 / breakeven OFF (single target 1:3) | 29.1% | +0.081R | -0.012R |

Default ab **TP1 = 1:2, TP2 = 1:3, 50% qty, breakeven ON** hai — Gold ke liye ye purane single-target setup se bhi behtar hai (winrate aur expectancy dono), aur UKOil ka drawdown bhi kaafi kam ho gaya (-49R se -22.5R). Silver phir bhi weak rehta he har configuration me.

## Settings tweak karna (optional)

- **Silver** thoda zyada volatile hota he — agar signals kam aa rahe hain to `Min ATR Ratio` thoda kam kar do (jaise 0.6)
- **UKOil** gaps aur news spikes zyada deta he — `ATR Length` badha ke (jaise 21) noise kam kar sakte ho
- Agar signals bahut kam aa rahe hain, `HTF Trend Filter` ko OFF kar ke dekho

## Disclaimer

Ye tool sirf decision-support he, guaranteed profit ka promise nahi karta. Risk management (stop loss, position size) khud discipline se follow karo.
