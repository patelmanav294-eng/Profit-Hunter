import { describe, expect, it } from "vitest";

import {
  adx,
  atr,
  bollinger,
  ema,
  highest,
  lowest,
  macd,
  rsi,
  sma,
  stochastic,
  trueRange,
  wilderSmooth,
} from "../src/engine/indicators";
import { bars } from "./helpers";

describe("sma", () => {
  it("averages the trailing window and leaves the warm-up undefined", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([undefined, undefined, 2, 3, 4]);
  });

  it("returns all undefined when there are fewer values than the period", () => {
    expect(sma([1, 2], 5)).toEqual([undefined, undefined]);
  });

  it("rejects a non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(/positive integer/);
  });
});

describe("ema", () => {
  it("seeds with a simple average, then applies the smoothing factor", () => {
    // period 3 → k = 0.5. Seed = mean(1,2,3) = 2.
    // i=3: (4-2)*0.5+2 = 3.  i=4: (5-3)*0.5+3 = 4.
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([undefined, undefined, 2, 3, 4]);
  });

  it("converges towards a constant input", () => {
    const result = ema(new Array(50).fill(10), 10);
    expect(result[49]).toBeCloseTo(10, 10);
  });
});

describe("wilderSmooth", () => {
  it("seeds with a mean and then weights the previous value by period-1", () => {
    // Seed at index 1 = mean(2,4) = 3.  i=2: (3*1 + 6)/2 = 4.5.
    expect(wilderSmooth([2, 4, 6], 2)).toEqual([undefined, 3, 4.5]);
  });

  it("honours a start offset, for series whose first value is meaningless", () => {
    // startIndex 1 skips element 0, so the seed is mean(4,6) = 5 at index 2.
    expect(wilderSmooth([99, 4, 6], 2, 1)).toEqual([undefined, undefined, 5]);
  });
});

describe("rsi", () => {
  it("computes Wilder's RSI against hand-calculated values", () => {
    // Alternating +1/-1 closes with period 2.
    // avgGain: 0.5, 0.75, 0.375   avgLoss: 0.5, 0.25, 0.625
    const result = rsi([10, 11, 10, 11, 10], 2);
    expect(result[0]).toBeUndefined();
    expect(result[1]).toBeUndefined();
    expect(result[2]).toBeCloseTo(50, 10);
    expect(result[3]).toBeCloseTo(75, 10);
    expect(result[4]).toBeCloseTo(37.5, 10);
  });

  it("pins to 100 when nothing in the window closed down", () => {
    const result = rsi([10, 11, 12, 13, 14], 2);
    expect(result[4]).toBe(100);
  });

  it("stays within 0..100 on noisy input", () => {
    const values = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 10 + Math.cos(i / 7) * 4);
    for (const value of rsi(values, 14)) {
      if (value === undefined) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("trueRange / atr", () => {
  const sample = bars([
    [9, 10, 8, 9],
    [10, 12, 9, 11],
    [12, 13, 12, 12.5],
  ]);

  it("uses the previous close for the gap-inclusive range", () => {
    // b0 has no previous close, so TR is simply high-low.
    // b1: max(12-9, |12-9|, |9-9|) = 3.   b2: max(1, |13-11|, |12-11|) = 2.
    expect(trueRange(sample)).toEqual([2, 3, 2]);
  });

  it("smooths true range the Wilder way", () => {
    // Seed at index 1 = mean(2,3) = 2.5.  i=2: (2.5*1 + 2)/2 = 2.25.
    expect(atr(sample, 2)).toEqual([undefined, 2.5, 2.25]);
  });
});

describe("bollinger", () => {
  it("uses the population standard deviation around the SMA", () => {
    const result = bollinger([2, 4, 6], 3, 2);
    const sd = Math.sqrt(8 / 3);
    expect(result.middle[2]).toBeCloseTo(4, 10);
    expect(result.upper[2]).toBeCloseTo(4 + 2 * sd, 10);
    expect(result.lower[2]).toBeCloseTo(4 - 2 * sd, 10);
  });

  it("collapses both bands onto the mean when the window is flat", () => {
    const result = bollinger([5, 5, 5, 5], 4, 2);
    expect(result.upper[3]).toBeCloseTo(5, 10);
    expect(result.lower[3]).toBeCloseTo(5, 10);
  });
});

describe("macd", () => {
  const values = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 5) * 3);

  it("is the difference of the two EMAs wherever both exist", () => {
    const fast = ema(values, 12);
    const slow = ema(values, 26);
    const result = macd(values, 12, 26, 9);

    for (let i = 0; i < values.length; i++) {
      const f = fast[i];
      const s = slow[i];
      if (f === undefined || s === undefined) {
        expect(result.macd[i]).toBeUndefined();
      } else {
        expect(result.macd[i]).toBeCloseTo(f - s, 10);
      }
    }
  });

  it("defines the histogram as line minus signal", () => {
    const result = macd(values, 12, 26, 9);
    for (let i = 0; i < values.length; i++) {
      const line = result.macd[i];
      const signal = result.signal[i];
      if (line === undefined || signal === undefined) {
        expect(result.histogram[i]).toBeUndefined();
      } else {
        expect(result.histogram[i]).toBeCloseTo(line - signal, 10);
      }
    }
  });

  it("refuses a fast period that is not faster than the slow one", () => {
    expect(() => macd(values, 26, 12, 9)).toThrow(/fast/);
  });
});

describe("stochastic", () => {
  it("locates the close within the window's range", () => {
    const sample = bars([
      [9, 10, 8, 9],
      [10, 12, 9, 11],
      [11, 13, 10, 12],
    ]);
    // Window high 13, low 8, close 12 → (12-8)/(13-8) = 80%.
    const result = stochastic(sample, 3, 1, 1);
    expect(result.k[2]).toBeCloseTo(80, 10);
  });

  it("reads 50 when the window has no range to normalise against", () => {
    const sample = bars([
      [5, 5, 5, 5],
      [5, 5, 5, 5],
      [5, 5, 5, 5],
    ]);
    expect(stochastic(sample, 3, 1, 1).k[2]).toBe(50);
  });
});

describe("adx", () => {
  it("reads high on a clean one-way trend", () => {
    const trending = bars(
      Array.from({ length: 80 }, (_, i): [number, number, number, number] => [
        100 + i,
        101 + i,
        99.5 + i,
        100.8 + i,
      ]),
    );
    const result = adx(trending, 14);
    const last = result[result.length - 1];
    expect(last).toBeDefined();
    // A textbook trend should comfortably clear the conventional 25 threshold.
    expect(last!).toBeGreaterThan(25);
  });

  it("stays within 0..100", () => {
    const choppy = bars(
      Array.from({ length: 120 }, (_, i): [number, number, number, number] => {
        const base = 100 + Math.sin(i / 2) * 5;
        return [base, base + 1, base - 1, base + Math.cos(i / 3)];
      }),
    );
    for (const value of adx(choppy, 14)) {
      if (value === undefined) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("highest / lowest", () => {
  it("includes the current bar in the rolling window", () => {
    expect(highest([1, 5, 3, 2], 2)).toEqual([undefined, 5, 5, 3]);
    expect(lowest([1, 5, 3, 2], 2)).toEqual([undefined, 1, 3, 2]);
  });
});
