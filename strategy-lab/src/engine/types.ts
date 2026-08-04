/**
 * Core domain types for the backtest engine.
 *
 * Everything here is plain data — no classes, no I/O — so the engine can run
 * unchanged in Node, in the browser, or inside a Web Worker.
 */

/** A single OHLC candle. `time` is the bar's OPEN time in epoch milliseconds. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type PriceField = "open" | "high" | "low" | "close";

/**
 * A computed series aligned 1:1 with the bar array.
 * `undefined` marks bars where the indicator has not warmed up yet.
 */
export type Series = (number | undefined)[];

/**
 * Contract specification for the traded instrument.
 *
 * P&L is computed as:
 *   (exit - entry) * contractSize * lots * quoteToAccountRate
 *
 * `quoteToAccountRate` exists because a EURUSD profit is denominated in USD.
 * If your account is in USD it stays 1. For a pair like EURGBP with a USD
 * account you would need the live GBPUSD rate; we keep it a constant because a
 * time-varying conversion series is a bigger modelling exercise than it is
 * worth for most single-pair strategies. It is surfaced in the report so the
 * assumption is never silent.
 */
export interface Instrument {
  symbol: string;
  /** Price increment of one pip, e.g. 0.0001 for EURUSD, 0.01 for USDJPY/XAUUSD. */
  pipSize: number;
  /** Units of the base asset in one standard lot, e.g. 100_000 for forex. */
  contractSize: number;
  /** Decimal places used when rounding prices. */
  digits: number;
  minLot: number;
  lotStep: number;
  maxLot: number;
  quoteToAccountRate: number;
}

/**
 * Transaction costs.
 *
 * Bar data is treated as the BID series. A buy therefore enters at
 * `price + spread` (the ask) and exits at `price`; a sell does the reverse.
 * The spread is paid exactly once per round trip, which is how a real broker
 * charges it. Slippage is applied on top, always against the trader.
 */
export interface CostModel {
  spreadPips: number;
  /** Account-currency commission charged per lot, on each side of the trade. */
  commissionPerLotPerSide: number;
  slippagePips: number;
}

export type Direction = "long" | "short";

/** Why a position was closed. Useful for spotting strategies that only ever time out. */
export type ExitReason =
  | "stopLoss"
  | "takeProfit"
  | "trailingStop"
  | "signal"
  | "maxBars"
  | "endOfData";

export interface Trade {
  id: number;
  direction: Direction;
  lots: number;
  entryBarIndex: number;
  entryTime: number;
  entryPrice: number;
  exitBarIndex: number;
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
  /** Stop-loss price at the moment of entry (undefined if the strategy sets none). */
  initialStopLoss?: number;
  takeProfit?: number;
  /** Gross P&L in account currency, before commission. */
  grossProfit: number;
  commission: number;
  /** Net P&L in account currency: gross minus commission. */
  netProfit: number;
  /**
   * Result expressed in R multiples — profit divided by the amount risked at
   * entry. `undefined` when the strategy trades without a stop, since there is
   * no defined risk to divide by.
   */
  rMultiple?: number;
  barsHeld: number;
  /** Account equity immediately after this trade closed. */
  equityAfter: number;
  /** Worst unrealised loss seen while the trade was open, in account currency. */
  maxAdverseExcursion: number;
  /** Best unrealised profit seen while the trade was open, in account currency. */
  maxFavorableExcursion: number;
}

export interface EquityPoint {
  time: number;
  /** Realised balance — only changes when a trade closes. */
  balance: number;
  /** Balance plus open-position P&L, marked to the bar close. */
  equity: number;
  /** Fractional drawdown from the running equity peak, e.g. 0.12 for -12%. */
  drawdown: number;
}
