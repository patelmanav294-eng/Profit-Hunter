/**
 * Seeded synthetic price generator.
 *
 * Two uses. First, it makes the engine testable and the UI demoable with no
 * network and no data files. Second — and more useful — it is a curve-fit
 * detector: run your strategy over a few dozen random-walk datasets with a
 * realistic drift of zero. Anything that still prints money there is reading
 * noise, and anything that loses roughly the spread is behaving as it should.
 */

import type { Bar } from "../engine/types";

export interface SyntheticOptions {
  bars: number;
  startPrice: number;
  /** Milliseconds between bars. Default 1 hour. */
  intervalMs?: number;
  startTime?: number;
  /** Per-bar standard deviation of returns. 0.001 ≈ 10 pips on a 1.0000 pair. */
  volatility?: number;
  /**
   * Expected per-bar return. Leave at 0 for an honest random walk — the
   * generator applies the convexity correction below so 0 really means zero
   * expected return, not zero log-return.
   */
  drift?: number;
  seed?: number;
  /**
   * Blends in a mean-reverting or trending component.
   * Positive values trend (momentum), negative mean-revert. Range roughly ±0.3.
   */
  autocorrelation?: number;
  /** Skip Saturday and Sunday bars, as an FX feed would. */
  skipWeekends?: boolean;
}

export function generateBars(options: SyntheticOptions): Bar[] {
  const {
    bars: count,
    startPrice,
    intervalMs = 3_600_000,
    startTime = Date.UTC(2024, 0, 1),
    volatility = 0.002,
    drift = 0,
    seed = 42,
    autocorrelation = 0,
    skipWeekends = false,
  } = options;

  if (count < 1) throw new Error(`Need at least 1 bar, got ${count}`);
  if (startPrice <= 0) throw new Error(`startPrice must be positive, got ${startPrice}`);

  const random = mulberry32(seed);
  const normal = gaussian(random);

  // Itô correction. Prices move multiplicatively, and E[exp(X)] = exp(Var/2) for
  // a zero-mean normal X — so exponentiating raw shocks quietly adds an upward
  // drift of σ²/2 per bar. Left uncorrected, a "zero drift" random walk trends
  // up, and the noise baseline this generator exists to provide would flatter
  // every strategy measured against it.
  const shockVariance = volatility * volatility * (1 + autocorrelation * autocorrelation);
  const convexityAdjustment = shockVariance / 2;

  const out: Bar[] = [];
  let price = startPrice;
  let previousShock = 0;
  let time = startTime;

  while (out.length < count) {
    if (skipWeekends) {
      const day = new Date(time).getUTCDay();
      if (day === 6 || day === 0) {
        time += intervalMs;
        continue;
      }
    }

    const shock = normal() * volatility;
    // AR(1): each bar inherits some of the previous shock, producing streaks
    // (trend) or reversals (mean reversion) instead of pure independence.
    const combined = shock + autocorrelation * previousShock;
    previousShock = shock;

    const open = price;
    const logReturn = drift - convexityAdjustment + combined;
    const close = open * Math.exp(logReturn);

    // Build the bar's range from a few intrabar steps so high/low are not just
    // max/min of open and close, which would make every wick zero.
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const intermediate = open * Math.exp(logReturn * ((s + 1) / steps) + normal() * volatility * 0.4);
      if (intermediate > high) high = intermediate;
      if (intermediate < low) low = intermediate;
    }

    out.push({
      time,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(500 + random() * 1500),
    });

    price = close;
    time += intervalMs;
  }

  return out;
}

/**
 * Generates `count` independent random-walk datasets sharing a base seed.
 * Feed these to a strategy to see the distribution of results it produces on
 * data with no edge in it.
 */
export function generateNoiseSuite(count: number, options: Omit<SyntheticOptions, "seed">): Bar[][] {
  return Array.from({ length: count }, (_, i) => generateBars({ ...options, seed: 1000 + i }));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

/** Small, fast, seeded PRNG. Deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller transform: uniform randoms in, standard normals out. */
function gaussian(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    // Guard against log(0).
    while (u === 0) u = random();
    while (v === 0) v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}
