# IFVG v2.0.6 — Backtest Findings aur Recommended Settings

Tumhare `Inverse Fair Value Gap v2.0.6 [Manav]` indicator ka poora backtest.
Logic Python me port karke Gold (XAUUSD) par pichhle 2 saal ke H1 data par chalaya:
**885 IFVG conversions**, trading cost (0.05R per exit) ke saath.

Run karne ke liye: `python3 pine-scripts/ifvg_backtest.py`

---

## Sabse zaroori baat pehle

**Tumhare current default settings unseen data par paisa khaate hain.**

Settings sirf pehle 60% data (Mar 2024 – Aug 2025) par choose ki, phir baaki 40%
(Aug 2025 – Aug 2026) par verify ki — jo data chunte waqt dekha hi nahi tha:

| Setup | Train expectancy | **Test (unseen)** | Test PF | Verdict |
|---|---|---|---|---|
| Pine defaults (SL 0.3, RR 1:4) | +0.322R | **−0.131R** | 0.85 | ❌ loss |
| Wider stop (SL 0.8, RR 1:4) | +0.445R | −0.050R | 0.94 | ❌ loss |
| + **Bullish IFVG only** | +0.693R | **+0.280R** | 1.36 | ✅ |
| + **Impulse (I) zaroori** | +0.753R | +0.275R | 1.36 | ✅ |
| + **HTF trend filter ON** | +0.691R | **+0.546R** | 1.76 | ✅ **best** |

Do filters ne loss ko profit me badal diya: **sirf Bullish IFVG lena**, aur
**HTF trend filter ON rakhna**. In dono ke bina setup unseen data par negative hai.

---

## Recommended settings

Ye tumhare indicator me abhi set kar sakte ho:

| Input | Value | Kyun |
|---|---|---|
| `Show Bullish IFVG (support)` | **ON** | isi side ka edge hai |
| `Show Bearish IFVG (resistance)` | **OFF** | unseen data par −0.239R |
| `Filter by HTF Trend` | **ON** | expectancy +0.280R → +0.546R |
| `SL Buffer beyond zone (ATR ×)` | **0.8** | 0.3 se behtar; tight stops wick par mar jaate hain |
| `R:R Target` | **4.0** | 1:3 aur 1:5 dono se behtar nikla |
| `Entry Trigger` | **Wick touch** | "Close inside" aadhe trades kha jaata hai |
| `Min Strength` | 4 | theek hai, lekin niche "star system" section padho |
| `★ V — Volume Star` | OFF | pehle se sahi (XAUUSD tick volume) |
| `Mitigation Trigger` | koi bhi | wick-touch entry ke saath farak nahi padta |

**Full period par is setup ka result:**

```
159 trades · win 34.0% · expectancy +0.648R · PF 1.93 · net +103.1R · maxDD −14.7R
Average jeet +3.95R | average haar −1.05R | realized R:R 1 : 3.76
Har ~6 din me 1 trade (5.5 per month)
```

---

## Star system me do stars ulta kaam kar rahe hain

Har factor ko alag se naapa (H1, 849 trades):

| Star | Kya hai | Present | Absent | Farak |
|---|---|---|---|---|
| **I** (Impulse) | body ≥ 60% of range | **+0.230R** | −0.119R | **+0.349R** ✅ |
| **D** (Displacement) | close FVG se 0.3 ATR aage | +0.127R | +0.079R | +0.048R 🔸 |
| **L** (Large) | range ≥ 0.5 ATR | +0.104R | +0.126R | −0.022R ⬜ |
| **S** (Sweep) | liquidity sweep ke baad | −0.057R | **+0.135R** | **−0.192R** ❌ |
| **H** (Huge) | range ≥ 1.0 ATR | +0.055R | **+0.262R** | **−0.207R** ❌ |

- **I hi asli filter hai.** Impulse wale break candles clearly behtar hain, aur ye
  effect train aur test dono halves me dikha (+0.534R train, +0.201R test).
- **H aur S ulta nuksan karte hain** — lekin dono star count me jud jaate hain.
  Isliye `Min Strength` badhane se quality badhti nahi: ★6 wale trades actually
  **negative** nikle (−0.124R, 54 trades), jabki ★4-5 positive the.
- **L 98% trades me present hai**, isliye wo filter hi nahi kar raha.

Matlab: **star count par bharosa mat karo, Impulse par karo.**

---

## Direction — sabse bada single lever

| | Train | Test (unseen) |
|---|---|---|
| **Bullish IFVG (support)** | +0.510R | **+0.217R** ✅ |
| **Bearish IFVG (resistance)** | +0.093R | **−0.239R** ❌ |

Bullish dono halves me positive raha, bearish test me toot gaya. H4 par to farak
aur bada hai (bullish +0.416R vs bearish −0.358R).

Iski ek badi wajah: 2024-26 gold ka strong bull run tha. Bearish zones ke against
market lagatar upar ja raha tha. **Sideways ya bear market me ye direction bias
badal sakta hai** — isliye ise "gold hamesha bullish" mat samajhna.

---

## SL buffer × R:R grid (H1, ★4)

Expectancy R per trade:

| SL buf | RR 1:1 | 1:1.5 | 1:2 | 1:3 | **1:4** | 1:5 | 1:6 |
|---|---|---|---|---|---|---|---|
| 0.1 | +0.075 | +0.078 | +0.061 | +0.075 | +0.086 | +0.172 | +0.203 |
| 0.2 | +0.115 | +0.070 | +0.041 | +0.021 | +0.103 | +0.174 | +0.156 |
| 0.3 *(default)* | +0.144 | +0.059 | +0.043 | +0.076 | +0.151 | +0.101 | +0.107 |
| 0.5 | +0.107 | +0.088 | +0.068 | +0.173 | +0.170 | +0.226 | +0.173 |
| **0.8** | +0.080 | +0.055 | +0.129 | +0.195 | **+0.260** | +0.173 | +0.137 |
| 1.2 | +0.078 | +0.094 | +0.128 | +0.170 | +0.150 | +0.152 | +0.121 |

Wide stops (0.5–0.8 ATR) consistently behtar hain tight stops se — IFVG zones ke
edges par wicks lagti hain, aur 0.1–0.3 buffer un wicks me kat jaata hai.

**Lekin dhyan do:** is grid me se sirf **6/42 settings (14%)** unseen data par
profitable rahi. Yaani grid ka best number apne aap me bharosemand nahi hai —
isiliye upar wala direction + Impulse + HTF filter wala combo zyada important hai
(wo grid ke best se bhi behtar test par nikla).

---

## Ek achhi khabar: IFVG zones random levels se behtar hain

Null test — wahi SL/TP mechanics, lekin entry **random price levels** par:

| | Expectancy |
|---|---|
| IFVG zones | **+0.260R** (588 trades) |
| Random levels | −0.046R [5th −0.186, 95th +0.093] |
| p-value | **0.000** |

Matlab **IFVG concept me asli information hai** — ye random support/resistance
se behtar hai. Problem concept me nahi, parameter tuning me hai.

---

## Timeframe

| | Trades | Win | Expectancy | PF |
|---|---|---|---|---|
| **H1** | 591 | 24.0% | +0.151R | 1.19 |
| H4 | 198 | 21.2% | +0.011R | 1.01 |

H1 par zyada trades aur behtar edge. H4 par bullish-only bahut accha dikhta hai
(+0.416R) lekin sirf 133 trades ka sample hai.

---

## Paisa (recommended setup, lot quantised, 0.01 lot = 1 oz)

Is setup ka 1R median **$12.24 per ounce** hai (chhota, kyunki zone-edge entry
hai) — isliye chhote account par bhi size karna aasan hai.

| Capital | 1% risk | 2% risk | 3% risk |
|---|---|---|---|
| $1,000 | $2,378 (−22%) | $4,900 (−23%) | $11,626 (−37%) |
| $2,000 | $4,268 (−14%) | $11,199 (−25%) | $27,000 (−37%) |
| $3,000 | $7,271 (−13%) | $18,426 (−26%) | $41,413 (−38%) |
| $5,000 | $11,996 (−13%) | $31,673 (−27%) | $71,366 (−38%) |

(bracket me max drawdown)

⚠️ **Ye numbers bade lag rahe hain — inhe guarantee mat samajhna:**
- Sabse lambi losing streak **15 trades lagatar** thi. 3% risk par wo −37% drawdown.
- Test half me sirf **47 trades** the — chhota sample, wide margin of error.
- 2024-26 gold ka exceptional bull run tha, aur poora edge bullish side se aaya.

---

## Pine me ek cheez add karni padegi: "Impulse zaroori"

Indicator me abhi `Min Strength` hai, lekin **specifically Impulse maangne ka
option nahi** — aur wahi sabse strong filter nikla. Ye patch add karo:

**1) Inputs section me (`grpStr` group ke saath) ye line jodo:**

```pine
requireImpulse = input.bool(true, "★ I — Impulse ZAROORI (sirf impulse break lo)", group=grpStr,
     tooltip="Backtest: impulse wale IFVG +0.230R, bina impulse -0.119R. Ye single sabse strong filter hai.")
```

**2) Section 5 me, jahan `iPass` bana hai, use badlo:**

```pine
// pehle:
// iPass         = iStrong and htfOK

// ab:
impulseOK     = not requireImpulse or fI
iPass         = iStrong and htfOK and impulseOK
```

Bas itna. Bullish-only pehle se possible hai (`Show Bearish IFVG` OFF karke),
aur SL buffer / R:R Risk Tools group me already inputs hain.

---

## Imaandari se

- Ye sab **ek hi 2-saal ke window** par hai, aur wo gold ka bull run tha.
- Recommended combo ka unseen-data sample sirf **47 trades** hai. Us size par
  +0.546R ka confidence interval kaafi wide hai.
- Grid ka 14% robustness score batata hai ki **parameter tuning is data par
  aasani se overfit ho jaati hai** — isliye maine grid-best ke bajaye structural
  filters (direction, impulse, HTF) recommend kiye, jo dono halves me tike.
- Data futures (GC=F) ka hai; tumhare broker ka spot/CFD feed thoda alag hoga.
- Overnight gaps aur weekend risk model nahi kiye gaye.

**Live paisa lagane se pehle demo par 2-3 mahine chalao**, aur risk 1-2% se zyada
mat rakhna — 15 trades ki losing streak is setup me normal hai.
