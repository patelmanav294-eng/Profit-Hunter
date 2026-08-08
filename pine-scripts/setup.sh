#!/usr/bin/env bash
# Trend Anchor — ek baar chalao, bas.
set -euo pipefail

echo "Trend Anchor setup"
echo "=================="

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 nahi mila. Pehle Python install karo: https://python.org/downloads"
  exit 1
fi
echo "  python3  $(python3 --version 2>&1 | cut -d' ' -f2)"

echo "  pandas + numpy install ho rahe hain..."
python3 -m pip install --quiet --upgrade pandas numpy 2>&1 | grep -v "^WARNING" || true

python3 - <<'PY'
import pandas, numpy
print(f"  pandas   {pandas.__version__}")
print(f"  numpy    {numpy.__version__}")
PY

echo "  Yahoo Finance connection check..."
python3 - <<'PY'
import sys, urllib.request, json
try:
    u = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1d"
    r = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    d = json.loads(urllib.request.urlopen(r, timeout=20).read())
    px = d["chart"]["result"][0]["meta"]["regularMarketPrice"]
    print(f"  Gold abhi   ${px:,.2f}/oz  — data mil raha hai")
except Exception as e:
    print(f"  Data fetch fail hua: {e}")
    print("  Internet check karo. VPN on hai to off karke dekho.")
    sys.exit(1)
PY

echo
echo "Sab ready. Ab ye chala sakte ho:"
echo "  python3 pine-scripts/backtest.py     # 2-saal ka backtest"
echo "  python3 pine-scripts/validate.py     # reality check (slow)"
echo
echo "Ya Claude Code CLI kholo aur /backtest, /validate, /chart, /tune type karo."
