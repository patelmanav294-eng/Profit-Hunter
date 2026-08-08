---
description: Recent Trend Anchor signal ko chart par render karke dikhao
---

Gold ka recent data lekar Trend Anchor ke signals nikaalo aur ek trade chart par render karo.

Steps:

1. `pine-scripts/backtest.py` ke functions import karke Gold H1 data lo aur signal logic
   chalao (`fetch_yahoo`, `rsi`, `macd`, `atr`, `build_htf_trend` — sab wahan hain)
2. Indicator ka state machine replicate karo: entry par SL = 2.0×ATR, TP1 = 1:2.5,
   TP1 lagne par stop entry par shift, TP2 = 1:5
3. Ek aisa trade chuno jo poora flow dikhaye (TP1 laga phir TP2), signal ke aas-paas
   ~100 candles lo
4. HTML artifact banao: candlesticks + EMA 9/21 + BUY label + Entry/SL/TP1/TP2 lines +
   TP1 hit marker + info panel. `artifact-design` skill pehle load karo.

$ARGUMENTS me instrument ya trade type (jaise "loss wala trade dikha") diya ho to wahi chuno.

**Zaroori:** agar jeetne wala trade dikha rahe ho to page par saaf likhna ki ye jaan-bujh kar
chuna gaya hai — asli me 60% trades stop par jaate hain TP1 tak pahunche bina.
