---
description: Trend Anchor ka 2-saal backtest chalao aur result samjhao
---

`python3 pine-scripts/backtest.py` chalao (2-3 minute lag sakta hai — Yahoo se data download hota hai).

Phir result Hinglish me samjhao:

- Gold ka number sabse pehle — wahi trade karne layak hai
- Har metric ka matlab batao, sirf table mat paste karo. Khaas kar **expectancy** —
  "+0.693R matlab agar tum 1% risk karte ho to average +0.69% per trade"
- Silver aur UKOil ka number bhi dikhao lekin saaf batao ki wo trade karne layak nahi
  (Silver ka spread uska edge kha jaata hai, UKOil ka drawdown risk ke layak nahi)
- Agar numbers pichhli baar se alag aayein to wajah batao — 2-saal ka window roz aage
  khisakta hai, isliye thoda farak normal hai

$ARGUMENTS me koi instrument ya setting di ho to `pine-scripts/backtest.py` ke top wale
constants (`COST_R`, `PER_SYMBOL_SETTINGS`, `LONGS_ONLY`) usi hisab se badal kar chalao,
aur baad me wapas default par le aao.
