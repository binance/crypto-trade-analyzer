import { withHttpRetry } from '../../utils/utils';
import {
  readCacheEntryFromLocalStorage,
  writeCacheEntryToLocalStorage,
  removeKeyFromLocalStorage,
  isFresh,
} from '../../utils/local-storage';
import type { OrderSide } from '../../core/interfaces/order-book';

export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  raw: Record<string, unknown>;
};

export type SentimentSummary = {
  hoursBack: number;
  totalGreen: number;
  totalRed: number;
  totalIntervals: number;
  recentGreen: number;
  recentRed: number;
  recentIntervals: number;
  baseBuyProbability: number;
  baseSellProbability: number;
  recentBuyProbability: number;
  recentSellProbability: number;
  finalBuyProbability: number;
  finalSellProbability: number;
  lastUpdated: string;
};

type Options = {
  cacheTtlMs?: number;
  hoursBack?: number;
  recentWindowSize?: number;
  recentWeight?: number;
};

type CoindeskCandle = {
  UNIT?: string;
  TIMESTAMP?: number;
  OPEN?: number;
  HIGH?: number;
  LOW?: number;
  CLOSE?: number;
  [key: string]: unknown;
};

type Interval = {
  dir: 'green' | 'red';
  index: number;
};

/**
 * MarketSignals service for analyzing cryptocurrency market sentiment based on historical candle data.
 *
 * This class fetches historical market data from Coindesk, normalizes it into candle objects,
 * and computes buy/sell sentiment probabilities based on price movement patterns.
 *
 * Features:
 * - Caches candle data in memory and localStorage to minimize API calls
 * - Configurable cache TTL and lookback period
 * - Sentiment analysis using both historical and recent price movements
 * - Weighted probability calculation favoring recent market action
 * - Automatic cache invalidation and refresh capabilities
 *
 */
export class MarketSignals {
  private cacheCandles: Candle[] | null = null;
  private inflightCandles?: Promise<Candle[]>;
  private candlesTs = 0;

  private readonly cacheTtlMs: number;
  private readonly hoursBack: number;
  private readonly recentWeight: number;
  private readonly recentWindowSize?: number;

  constructor(opts: Options = {}) {
    this.cacheTtlMs = opts.cacheTtlMs ?? 60 * 60 * 1000; // 1 hour
    this.hoursBack = opts.hoursBack ?? 24;
    this.recentWeight = opts.recentWeight ?? 0.7;
    this.recentWindowSize = opts.recentWindowSize;
  }

  /**
   * Generates a local storage key for storing candle data.
   * @returns A string key formatted as `marketsignals:v1:candles:global:hours:{hoursBack}` used to store and retrieve candle data from local storage.
   * @private
   */
  private getLocalStorageKeyCandles(): string {
    return `marketsignals:v1:candles:global:hours:${this.hoursBack}`;
  }

  /**
   * Fetches raw candlestick data from the Coindesk API.
   *
   * @returns {Promise<CoindeskCandle[]>} A promise that resolves to an array of candlestick data.
   * @throws {Error} Throws an error if the HTTP request fails after 3 retry attempts.
   * @throws {Error} Throws an error if the response status is not ok.
   * @throws {Error} Throws an error if the returned data is not a valid array or contains fewer than 2 candles.
   *
   * @private
   * @async
   */
  private async fetchRawCandles(): Promise<CoindeskCandle[]> {
    const url = `https://data-api.coindesk.com/overview/v1/historical/marketcap/all/assets/hours?limit=${this.hoursBack}`;

    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!res.ok) throw new Error(`Failed to fetch Coindesk historical data ${res.status}`);

    const json = await res.json();
    const candles = json?.Data;
    if (!Array.isArray(candles) || candles.length < 2)
      throw new Error('Not enough candles returned from Coindesk');

    return candles as CoindeskCandle[];
  }

  /**
   * Loads fresh candles by fetching raw data, normalizing it, and sorting by timestamp.
   * @returns A promise that resolves to an array of candles sorted in ascending order by timestamp.
   * @private
   */
  private async loadFreshCandles(): Promise<Candle[]> {
    const raw = await this.fetchRawCandles();
    const normalized = raw
      .map((c) => {
        const ts = Number(c.TIMESTAMP ?? 0) * 1000;
        const open = Number(c.OPEN);
        const high = Number(c.HIGH);
        const low = Number(c.LOW);
        const close = Number(c.CLOSE);

        if (
          !Number.isFinite(ts) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close)
        )
          return null;

        return {
          ts,
          open,
          high,
          low,
          close,
          raw: c as Record<string, unknown>,
        };
      })
      .filter((x): x is Candle => !!x);

    return normalized.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Retrieves candlestick data with multi-level caching strategy.
   *
   * Implements a caching hierarchy: in-memory cache → localStorage → fresh API fetch.
   * Prevents duplicate concurrent requests using an inflight flag.
   *
   * @param force - If true, bypasses all caches and fetches fresh data. Defaults to false.
   * @returns Promise resolving to an array of Candle objects.
   *
   * @remarks
   * - In-memory cache is checked first if not forced
   * - localStorage is checked second if in-memory miss
   * - Only performs fresh load if caches are stale or missing
   * - Concurrent requests reuse the same inflight promise
   * - Cache freshness is determined by {@link isFresh} function and {@link cacheTtlMs}
   */
  private async getCandles(force = false): Promise<Candle[]> {
    const now = Date.now();
    const lsKey = this.getLocalStorageKeyCandles();

    if (!force && this.cacheCandles && isFresh(this.candlesTs, this.cacheTtlMs))
      return this.cacheCandles;

    if (!force) {
      const cached = readCacheEntryFromLocalStorage<Candle[]>(lsKey);
      if (cached && isFresh(cached.ts, this.cacheTtlMs)) {
        this.cacheCandles = cached.data;
        this.candlesTs = cached.ts;
        return cached.data;
      }
    }

    if (this.inflightCandles) return this.inflightCandles;

    this.inflightCandles = this.loadFreshCandles()
      .then((candles) => {
        this.cacheCandles = candles;
        this.candlesTs = now;
        writeCacheEntryToLocalStorage(lsKey, candles);
        return candles;
      })
      .finally(() => {
        this.inflightCandles = undefined;
      });

    return this.inflightCandles;
  }

  /**
   * Computes sentiment analysis for market candles by analyzing price movements.
   *
   * This method calculates buy/sell probabilities based on two components:
   * - **Base probability**: Historical ratio of green (up) to red (down) intervals across all candles
   * - **Recent probability**: Weighted ratio of recent intervals (last N candles) to emphasize current market action
   *
   * The final probability is a weighted blend of base and recent probabilities, with recent market action
   * having heavier influence (controlled by `recentWeight`).
   *
   * @param candles - Array of candle data points to analyze
   * @returns A `SentimentSummary` object containing:
   *   - Total and recent green/red interval counts
   *   - Base buy/sell probabilities from all intervals
   *   - Recent buy/sell probabilities from the recent window
   *   - Final blended buy/sell probabilities (normalized to sum to 1.0)
   *   - Timestamp of the analysis
   *
   * @remarks
   * - Flat intervals (where close price equals previous close) are ignored
   * - Default values of 0.5 are used if probabilities are invalid or no intervals exist
   * - All probability values are validated to remain within [0, 1] range
   * - Recent window size defaults to minimum of 4 or total intervals if not configured
   */
  private computeSentiment(candles: Candle[]): SentimentSummary {
    const intervals: Interval[] = [];

    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close;
      const currClose = candles[i].close;

      if (currClose > prevClose) intervals.push({ dir: 'green', index: i - 1 });
      else if (currClose < prevClose) intervals.push({ dir: 'red', index: i - 1 });
      // equal: flat interval -> ignored
    }

    const totalIntervals = intervals.length;

    let totalGreen = 0;
    let totalRed = 0;
    for (const it of intervals) {
      if (it.dir === 'green') totalGreen += 1;
      else totalRed += 1;
    }

    // Base probabilities from ALL intervals
    let baseBuy = 0.5;
    let baseSell = 0.5;

    if (totalIntervals > 0) {
      baseBuy = totalGreen / totalIntervals;
      baseSell = totalRed / totalIntervals;
    }

    if (!Number.isFinite(baseBuy) || baseBuy < 0 || baseBuy > 1) baseBuy = 0.5;
    if (!Number.isFinite(baseSell) || baseSell < 0 || baseSell > 1) baseSell = 1 - baseBuy;

    // Recent window: last N intervals (more weight to recent market action)
    const recentWindowSize = this.recentWindowSize ?? Math.min(4, totalIntervals);
    const recentIntervalsArr = recentWindowSize > 0 ? intervals.slice(-recentWindowSize) : [];

    let recentGreen = 0;
    let recentRed = 0;

    for (const it of recentIntervalsArr) {
      if (it.dir === 'green') recentGreen += 1;
      else recentRed += 1;
    }

    let recentBuy = 0.5;
    let recentSell = 0.5;

    if (recentWindowSize > 0) {
      recentBuy = recentGreen / recentWindowSize;
      recentSell = recentRed / recentWindowSize;
    }

    if (!Number.isFinite(recentBuy) || recentBuy < 0 || recentBuy > 1) recentBuy = 0.5;
    if (!Number.isFinite(recentSell) || recentSell < 0 || recentSell > 1)
      recentSell = 1 - recentBuy;

    // Blend base + recent with heavier weight on recent
    const recentWeight = this.recentWeight;
    const baseWeight = 1 - recentWeight;

    let finalBuy = recentWeight * recentBuy + baseWeight * baseBuy;
    let finalSell = 1 - finalBuy;

    if (!Number.isFinite(finalBuy) || finalBuy < 0 || finalBuy > 1) {
      finalBuy = 0.5;
      finalSell = 0.5;
    }

    return {
      hoursBack: this.hoursBack,
      totalGreen,
      totalRed,
      totalIntervals,
      recentGreen,
      recentRed,
      recentIntervals: recentWindowSize,
      baseBuyProbability: baseBuy,
      baseSellProbability: baseSell,
      recentBuyProbability: recentBuy,
      recentSellProbability: recentSell,
      finalBuyProbability: finalBuy,
      finalSellProbability: finalSell,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Determines the order side (buy or sell) based on market sentiment analysis.
   *
   * Uses computed sentiment probabilities to make a probabilistic decision on whether
   * to place a buy or sell order. Probabilities are normalized if needed, and a random
   * value is used to select the order side according to the buy probability.
   *
   * @param force - If true, forces a fresh calculation of candles data. Defaults to false.
   * @param rng - Random number generator function that returns a value between 0 and 1.
   *              Defaults to Math.random. Useful for testing with deterministic values.
   * @returns A promise that resolves to the order side: either 'buy' or 'sell'.
   *
   * @remarks
   * If computed probabilities are invalid (sum <= 0 or non-finite), both probabilities
   * are reset to 0.5 for equal weighting. Otherwise, probabilities are normalized to
   * ensure they sum to 1.
   */
  async getOrderSideFromMarketSentiment(
    force = false,
    rng: () => number = Math.random
  ): Promise<OrderSide> {
    const candles = await this.getCandles(force);
    const summary = this.computeSentiment(candles);

    let { finalBuyProbability, finalSellProbability } = summary;

    const sum = finalBuyProbability + finalSellProbability;
    if (sum <= 0 || !Number.isFinite(sum)) {
      finalBuyProbability = 0.5;
      finalSellProbability = 0.5;
    } else if (Math.abs(sum - 1) > 1e-6) {
      finalBuyProbability /= sum;
      finalSellProbability /= sum;
    }

    return rng() < finalBuyProbability ? 'buy' : 'sell';
  }

  /**
   * Clears the cached candles data and removes it from local storage.
   * Resets the candles cache to null and the timestamp to 0.
   */
  clear() {
    this.cacheCandles = null;
    this.candlesTs = 0;
    const lsKeyCandles = this.getLocalStorageKeyCandles();
    removeKeyFromLocalStorage(lsKeyCandles);
  }
}
