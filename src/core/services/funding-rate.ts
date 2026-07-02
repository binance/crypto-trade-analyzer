import { withHttpRetry } from '../../utils/utils';
import { FUTURES_REST_API_URL as BINANCE_FUTURES_REST_API_URL } from '../../exchanges/binance/utils/constants';
import { REST_API_URL as BYBIT_REST_API_URL } from '../../exchanges/bybit/utils/constants';
import { REST_API_URL as OKX_REST_API_URL } from '../../exchanges/okx/utils/constants';
import type { CostBreakdown } from '../interfaces/fee-config';

/**
 * Current funding for a perpetual contract.
 * - `ratePerInterval`: the funding rate charged each interval (decimal, e.g. 0.0001 = 0.01%).
 *   Positive means longs pay shorts.
 * - `intervalHours`: hours between funding settlements (commonly 8; some pairs use 4 or 1).
 */
export type FundingInfo = { ratePerInterval: number; intervalHours: number };

const DEFAULT_INTERVAL_HOURS = 8;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — funding moves slowly relative to a quote
const INTERVAL_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — funding intervals change very rarely

type ExchangeKey = 'Binance' | 'Bybit' | 'OKX';

interface CacheEntry {
  info: FundingInfo;
  expires: number;
}

class FundingRateService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<FundingInfo | undefined>>();

  private binanceIntervals = new Map<string, number>();
  private binanceIntervalsExpires = 0;
  private binanceIntervalsInflight?: Promise<void>;

  /**
   * Returns current funding info for the given exchange + contract symbol.
   * `symbol` is the exchange-native id (e.g. Binance/Bybit `BTCUSDT`, OKX `BTC-USDT-SWAP`).
   * Returns undefined on failure (callers should treat funding as 0).
   */
  async getFunding(exchange: ExchangeKey, symbol: string): Promise<FundingInfo | undefined> {
    const key = `${exchange}:${symbol}`;
    const now = Date.now();

    const cached = this.cache.get(key);
    if (cached && cached.expires > now) return cached.info;

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const run = (async (): Promise<FundingInfo | undefined> => {
      try {
        const info = await this.fetch(exchange, symbol);
        if (info) this.cache.set(key, { info, expires: Date.now() + CACHE_TTL_MS });
        return info;
      } catch (e) {
        console.warn(`Failed to fetch funding for ${key}:`, e);
        return undefined;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, run);
    return run;
  }

  private async fetch(exchange: ExchangeKey, symbol: string): Promise<FundingInfo | undefined> {
    if (exchange === 'Binance') return this.fetchBinance(symbol);
    if (exchange === 'Bybit') return this.fetchBybit(symbol);
    if (exchange === 'OKX') return this.fetchOkx(symbol);
  }

  /**
   * Loads Binance per-symbol funding intervals from /fapi/v1/fundingInfo (one call lists all
   * symbols with explicit intervals/caps). Cached ~1h. Symbols absent from the response use 8h.
   */
  private async loadBinanceIntervals(): Promise<void> {
    if (Date.now() < this.binanceIntervalsExpires && this.binanceIntervals.size > 0) return;
    if (this.binanceIntervalsInflight) return this.binanceIntervalsInflight;

    this.binanceIntervalsInflight = (async () => {
      try {
        const url = `${BINANCE_FUTURES_REST_API_URL}/fundingInfo`;
        const res = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{
          symbol?: string;
          fundingIntervalHours?: number;
        }>;
        const map = new Map<string, number>();
        for (const r of rows) {
          const h = Number(r?.fundingIntervalHours);
          if (r?.symbol && Number.isFinite(h) && h > 0) map.set(r.symbol.toUpperCase(), h);
        }
        if (map.size > 0) {
          this.binanceIntervals = map;
          this.binanceIntervalsExpires = Date.now() + INTERVAL_CACHE_TTL_MS;
        }
      } catch (e) {
        console.warn('Failed to load Binance funding intervals:', e);
      } finally {
        this.binanceIntervalsInflight = undefined;
      }
    })();
    return this.binanceIntervalsInflight;
  }

  private async fetchBinance(symbol: string): Promise<FundingInfo | undefined> {
    const ratePromise = (async () => {
      const url = `${BINANCE_FUTURES_REST_API_URL}/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
      const res = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
      if (!res.ok) return undefined;

      const data = (await res.json()) as { lastFundingRate?: string };
      const r = Number(data?.lastFundingRate);

      return Number.isFinite(r) ? r : undefined;
    })();

    const [rate] = await Promise.all([ratePromise, this.loadBinanceIntervals()]);
    if (rate === undefined) return undefined;

    const intervalHours = this.binanceIntervals.get(symbol.toUpperCase()) ?? DEFAULT_INTERVAL_HOURS;
    return { ratePerInterval: rate, intervalHours };
  }

  private async fetchBybit(symbol: string): Promise<FundingInfo | undefined> {
    const url = `${BYBIT_REST_API_URL}/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`;
    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!res.ok) return undefined;

    const data = (await res.json()) as {
      result?: { list?: Array<{ fundingRate?: string; fundingIntervalHour?: string | number }> };
    };
    const row = data?.result?.list?.[0];
    const rate = Number(row?.fundingRate);

    if (!Number.isFinite(rate)) return undefined;
    const ih = Number(row?.fundingIntervalHour);
    const intervalHours = Number.isFinite(ih) && ih > 0 ? ih : DEFAULT_INTERVAL_HOURS;

    return { ratePerInterval: rate, intervalHours };
  }

  private async fetchOkx(instId: string): Promise<FundingInfo | undefined> {
    const url = `${OKX_REST_API_URL}/public/funding-rate?instId=${encodeURIComponent(instId)}`;
    const res = await withHttpRetry(() => fetch(url), { maxAttempts: 3 });
    if (!res.ok) return undefined;

    const data = (await res.json()) as {
      data?: Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>;
    };
    const row = data?.data?.[0];
    const rate = Number(row?.fundingRate);
    if (!Number.isFinite(rate)) return undefined;

    const ft = Number(row?.fundingTime);
    const nft = Number(row?.nextFundingTime);
    let intervalHours = DEFAULT_INTERVAL_HOURS;
    if (Number.isFinite(ft) && Number.isFinite(nft) && nft > ft) {
      const hrs = Math.round((nft - ft) / (60 * 60 * 1000));
      if (hrs > 0) intervalHours = hrs;
    }

    return { ratePerInterval: rate, intervalHours };
  }
}

/**
 * Computes the funding cost to the trader in USD over a holding period.
 * Positive = a net cost (reduces PnL); negative = a net credit.
 *
 * Long (buy) pays funding when the rate is positive; short (sell) receives it.
 *
 * @param info - Current funding info (rate per interval + interval length).
 * @param notionalUsd - Position notional in USD (execution value before fees).
 * @param side - 'buy' (long) or 'sell' (short).
 * @param holdingHours - How long the position is held, in hours.
 */
export function computeFundingCostUsd(
  info: FundingInfo,
  notionalUsd: number,
  side: 'buy' | 'sell',
  holdingHours: number
): number {
  if (!(notionalUsd > 0) || !(holdingHours > 0) || !(info.intervalHours > 0)) return 0;
  // Expected-value model: with uniform random entry timing, the expected number of
  // funding settlements crossed in a window of length H is H / I (not ceil(H/I)).
  // ceil systematically over-charges partial intervals — e.g. 48 min on an 8h
  // schedule yields ceil=1 settlement instead of the unbiased 0.1.
  const intervals = holdingHours / info.intervalHours;
  const sign = side === 'buy' ? 1 : -1;
  return sign * notionalUsd * info.ratePerInterval * intervals;
}

export const fundingRateService = new FundingRateService();

/**
 * Fetches funding and attaches a signed `funding` cost item (plus `holdingPeriodHours`) to a
 * futures cost breakdown, mutating and returning it. No-op when holdingHours is missing/negative.
 * When holdingHours is 0, stamps the period but adds no funding. When funding can't be fetched,
 * stamps `fundingMissing` (funding stays undefined → ranking treats it as 0, so the UI warns).
 *
 * @param breakdown - The cost breakdown to augment (mutated in place).
 * @param exchange - Funding source exchange.
 * @param symbol - Exchange-native contract id (e.g. `BTCUSDT`, `BTC-USDT-SWAP`).
 * @param side - Order side (long/short).
 * @param holdingHours - Holding period in hours.
 */
export async function attachFunding(
  breakdown: CostBreakdown,
  exchange: ExchangeKey,
  symbol: string,
  side: 'buy' | 'sell',
  holdingHours: number | undefined
): Promise<CostBreakdown> {
  if (holdingHours === undefined || holdingHours < 0) return breakdown;

  breakdown.holdingPeriodHours = holdingHours;

  if (holdingHours === 0) return breakdown;

  const info = await fundingRateService.getFunding(exchange, symbol);
  if (!info) {
    breakdown.fundingMissing = true;
    return breakdown;
  }

  const notionalUsd = breakdown.execution?.usd ?? 0;
  const fundingUsd = computeFundingCostUsd(info, notionalUsd, side, holdingHours);
  const usdPerQuote = breakdown.usdPerQuote || 0;

  breakdown.funding = {
    amount: usdPerQuote > 0 ? fundingUsd / usdPerQuote : 0,
    asset: breakdown.quoteAsset,
    usd: fundingUsd,
    rate: info.ratePerInterval,
  };
  breakdown.fundingIntervalHours = info.intervalHours;
  return breakdown;
}
