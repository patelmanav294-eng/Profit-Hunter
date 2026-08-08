---
description: SL/TP parameters tune karo — lekin out-of-sample par verify karke
---

$ARGUMENTS me diye gaye parameters ka sweep chalao (default: SL multiplier × TP1 × TP2).

**Method — isse shortcut mat karna:**

1. Data ko 60/40 me baanto. Settings **sirf pehle 60%** par choose karo.
2. Baaki 40% par test karo — wo data settings chunte waqt dekha hi nahi gaya
3. Sirf best number mat batao. Ye bhi batao ki **kitne % settings unseen data par profitable
   rahi** — ye robustness ka asli measure hai. Agar wo 30% se kam hai to grid ka best number
   bharosemand nahi hai, aur wahi user ko bolna
4. Har config par trade count batao. 30 se kam trades par koi conclusion mat nikalna
5. Cost hamesha include (`COST_R`)

Grid ke best number par jump mat karo — structural filters (direction, HTF filter) grid-tuned
parameters se zyada tikau nikle hain. Agar sweep ka best in-sample number out-of-sample par
gir jaata hai, to wo saaf bolo.
