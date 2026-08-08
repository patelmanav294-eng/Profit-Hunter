---
description: Reality check — signal random entries se behtar hai ya nahi (26 saal ka data)
---

`python3 pine-scripts/validate.py` chalao. Ye slow hai (~2-3 minute) — background me chalao
aur user ko bata do ki chal raha hai.

Ye script wo sawaal poochhta hai jo baaki sab backtest nahi poochhte: **agar entry ka time
random kar dein, wahi SL/TP rules ke saath, to kya hota hai?**

Result samjhate waqt:

- **H1 (2024-26)** par signal random se behtar nikalta hai, lekin us window me random entries
  bhi strongly positive thi — matlab strategy ke return ka aadha hissa sirf gold ka upar
  jaana hai
- **D1 (26 saal)** par signal random se behtar **nahi** nikla (p ≈ 0.55-0.60). Ye sabse
  important nateeja hai aur ise chhupana nahi
- Regime breakdown me 2012-15 ka gold bear market dikhao — wahan strategy loss me thi
- Buy & hold comparison: total return me buy & hold aage hai, lekin risk-adjusted me
  strategy kaafi behtar (return/drawdown 4.80 vs 1.38)

Nateeja saaf bolo: **ye prediction system nahi, risk-control system hai.**
