import Decimal from 'decimal.js';
import type { OrderBookListener } from '../core/interfaces/book-ws-client';
import type { OrderBook, OrderBookEntry, OrderSide } from '../core/interfaces/order-book';
import type { CostBreakdown } from '../core/interfaces/fee-config';
import type { ExchangeId } from '../exchanges';

interface HttpRetryOptions extends Omit<RetryOptions, 'retryCondition'> {
  retryStatusCodes?: number[];
  retryOnNetworkError?: boolean;
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryCondition?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Pauses execution for a specified number of milliseconds.
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a trading pair into its base and quote components.
 *
 * @param pair - The trading pair (e.g., "BTC-USDT" or "BTC/USDT").
 * @returns An object containing the base and quote asset symbols.
 */
export function parsePair(pair: string): { base: string; quote: string } {
  const [base, quote] = pair.includes('-') ? pair.split('-') : pair.split('/');
  return { base: (base || '').toUpperCase(), quote: (quote || '').toUpperCase() };
}

/**
 * Executes a function with exponential backoff retry logic.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects with the last error
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 10000,
    backoffFactor = 2,
    retryCondition = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts - 1) break;
      if (!retryCondition(error)) throw error;

      const delay = Math.min(baseDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);

      onRetry?.(attempt + 1, error);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Executes an HTTP request with retry logic.
 *
 * @param req - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects with the last error
 */
export async function withHttpRetry(
  req: () => Promise<Response>,
  options: HttpRetryOptions = {}
): Promise<Response> {
  const {
    retryStatusCodes = [429, 500, 502, 503, 504],
    retryOnNetworkError = true,
    ...retryOptions
  } = options;

  return withRetry(
    async () => {
      try {
        const resp = await req();
        if (!resp.ok) {
          const err = new Error(`HTTP ${resp.status}`) as Error & { response?: Response };
          err.response = resp;
          throw err;
        }
        return resp;
      } catch (e) {
        if (retryOnNetworkError && e instanceof TypeError) throw e;
        throw e;
      }
    },
    {
      ...retryOptions,
      retryCondition: (err: unknown) =>
        (retryOnNetworkError && err instanceof TypeError) ||
        (!!(err as { response?: { status?: number } })?.response?.status &&
          retryStatusCodes.includes((err as { response?: { status?: number } }).response!.status!)),
    }
  );
}

/**
 * Emits an order book update for a trading pair.
 *
 * @param listeners - The set of order book listeners.
 * @param pairKey - The trading pair key.
 * @param book - The order book snapshot.
 * @param exchange - The exchange name (optional).
 */
export function emitOrderBookUpdate(
  listeners: Set<OrderBookListener>,
  pairKey: string,
  book: OrderBook,
  exchange?: string
) {
  for (const cb of listeners) {
    try {
      cb(pairKey, book);
    } catch (err) {
      console.warn(`Failed to emit ${exchange} order book update`, err);
    }
  }
}

/**
 * Sends a message to the WebSocket.
 *
 * @param msg The message object to send.
 * @returns
 */
export function sendWsMessage(ws: WebSocket, msg: object) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

/**
 * Formats a number as a fiat currency string with customizable decimal places and compact notation.
 *
 * @param n - The number to format.
 * @param opts - Optional formatting options.
 * @param opts.minDecimals - Minimum number of decimal places (default: 2).
 * @param opts.maxDecimals - Maximum number of decimal places (default: 2).
 * @param opts.decimals - Fixed number of decimal places (overrides minDecimals and maxDecimals).
 * @param opts.compact - Whether to use compact notation (e.g., 1.2M, 3K).
 * @param opts.raw - If true, disables compact notation and formatting.
 * @returns The formatted string representation of the number, or '—' if the input is not finite.
 */
export const fiatNumberFormat = (
  n: number,
  opts: {
    minDecimals?: number;
    maxDecimals?: number;
    decimals?: number;
    compact?: boolean;
    raw?: boolean;
  } = {}
) => {
  if (!Number.isFinite(n)) return '—';

  const { minDecimals = 2, maxDecimals = 2, decimals, compact = false, raw = false } = opts;

  const abs = Math.abs(n);

  const minD = typeof decimals === 'number' ? decimals : minDecimals;
  const maxD = typeof decimals === 'number' ? decimals : abs < 1 ? 8 : maxDecimals;

  if (abs === 0)
    return (0).toLocaleString('en-US', {
      minimumFractionDigits: minD,
      maximumFractionDigits: minD,
    });

  // Handle large numbers with compact notation
  if (compact && !raw) {
    if (abs >= 1000000000) return (n / 1000000000).toFixed(3) + 'B';
    if (abs >= 1000000) return (n / 1000000).toFixed(3) + 'M';
    if (abs >= 10000) return (n / 1000).toFixed(0) + 'K';
  }

  // Handle very large numbers without compact notation
  if (!compact && !raw && abs >= 1000000) return (n / 1000000).toFixed(3) + 'M';

  return n.toLocaleString('en-US', {
    minimumFractionDigits: minD,
    maximumFractionDigits: maxD,
  });
};

/**
 * Formats a number for display in cryptocurrency contexts, supporting compact notation,
 * significant digits, trimming, and thresholds for tiny values.
 *
 * @param n - The number to format.
 * @param options - Formatting options.
 * @param options.minDecimals - Minimum number of decimal places to display (default: 4).
 * @param options.maxDecimals - Maximum number of decimal places to display (default: 8).
 * @param options.minSig - Minimum number of significant digits for small numbers (default: 3).
 * @param options.maxSig - Maximum number of significant digits.
 * @param options.tinyThreshold - Threshold below which the number is considered "tiny" (default: 1e-8).
 * @param options.tinyText - Text to display for "tiny" numbers (default: '<1e-8').
 * @param options.trim - Whether to trim trailing zeros in the decimal part (default: false).
 * @param options.compact - Whether to use compact notation for large numbers (e.g., 'K', 'M') (default: false).
 * @param options.raw - If true, disables compact formatting (default: false).
 * @returns The formatted number as a string, or a placeholder for non-finite values.
 */
export const cryptoNumberFormat = (
  n: number,
  {
    minDecimals = 4,
    maxDecimals = 8,
    minSig = 3,
    maxSig,
    tinyThreshold = 1e-8,
    tinyText = '<1e-8',
    trim = false,
    compact = false,
    raw = false,
  }: {
    minDecimals?: number;
    maxDecimals?: number;
    minSig?: number;
    maxSig?: number;
    tinyThreshold?: number;
    tinyText?: string;
    trim?: boolean;
    compact?: boolean;
    raw?: boolean;
  } = {}
) => {
  if (!Number.isFinite(n)) return '—';

  if (raw)
    return n.toLocaleString('en-US', {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    });

  let abs = Math.abs(n);
  if (abs === 0) return (0).toFixed(minDecimals);
  if (abs < tinyThreshold) return tinyText;

  if (typeof maxSig === 'number' && maxSig > 0) {
    let decimalPlaces: number;

    if (abs >= 1) {
      decimalPlaces = maxSig;
    } else {
      const leadingZeros = Math.floor(-Math.log10(abs));
      decimalPlaces = leadingZeros + maxSig;
    }

    n = Number(n.toFixed(decimalPlaces));
  }

  abs = Math.abs(n);

  // Handle large numbers with compact notation
  if (compact) {
    if (abs >= 1000000000) return (n / 1000000000).toFixed(3) + 'B';
    if (abs >= 1000000) return (n / 1000000).toFixed(3) + 'M';
    if (abs >= 10000) return (n / 1000).toFixed(3) + 'K';
  }

  // Handle very large numbers without compact notation
  if (!compact && abs >= 1000000) return (n / 1000000).toFixed(3) + 'M';

  if (abs >= 1000) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: minDecimals,
    });
  }

  if (abs >= 1) {
    const displayDecimals = compact ? Math.min(minDecimals, 4) : minDecimals;
    return n.toLocaleString('en-US', {
      minimumFractionDigits: displayDecimals,
      maximumFractionDigits: displayDecimals,
    });
  }

  const leadingZeros = Math.floor(-Math.log10(abs));
  const decimals = Math.min(
    Math.max(leadingZeros + (minSig - 1), minDecimals),
    compact ? Math.min(maxDecimals, 4) : maxDecimals
  );

  let s = n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (trim && s.includes('.')) {
    s = s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
    const [int, frac = ''] = s.split('.');
    if (frac.length < minDecimals) s = int + '.' + (frac + '0'.repeat(minDecimals - frac.length));
  }

  return s;
};

/**
 * Formats a number as a percentage string.
 *
 * @param n The number to format.
 * @returns The formatted percentage string.
 */
export const percentageNumberFormat = (n: number) => `${(n * 100).toFixed(4)}%`;

/**
 * Maps an order book to a standardized format.
 *
 * @param book The order book to map.
 * @returns The mapped order book.
 */
export function mapOrderBook(book: OrderBook): OrderBook {
  const mapSide = (arr: OrderBookEntry[] | undefined) =>
    arr?.map((l: OrderBookEntry) => ({ price: Number(l.price), quantity: Number(l.quantity) })) ??
    [];
  return { bids: mapSide(book?.bids), asks: mapSide(book?.asks) };
}

/**
 * Normalizes a trading pair string by removing all non-alphanumeric characters
 * and converting it to lowercase.
 *
 * @param s - The input string representing a trading pair.
 * @returns The normalized string containing only lowercase alphanumeric characters.
 */
export function normalizePairText(s: string) {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Buckets the order book prices into discrete intervals defined by the given tick size.
 *
 * For each side ('bid' or 'ask'), prices are grouped into buckets where each bucket represents
 * a price level rounded down (for bids) or up (for asks) to the nearest multiple of the tick size.
 * Quantities at the same bucket price are summed together.
 *
 * @param book - The original order book containing arrays of bids and asks.
 * @param tick - The tick size used to bucketize the price levels. Must be a positive number.
 * @returns A new order book with bids and asks bucketized by the specified tick size.
 */
export function bucketizeOrderBook(book: OrderBook, tick: number): OrderBook {
  if (!tick || tick <= 0) return book;

  const tickDecimal = new Decimal(tick);

  const bucketOneSide = (side: 'bid' | 'ask') => {
    const bucketMap = new Map<string, Decimal>();
    const levels = side === 'bid' ? book.bids : book.asks;

    for (const { price, quantity } of levels) {
      const priceDec = new Decimal(price);
      const quantityDec = new Decimal(quantity);
      const ratio = priceDec.div(tickDecimal);
      const idx = side === 'bid' ? ratio.floor() : ratio.ceil();
      const bp = idx.mul(tickDecimal);
      const key = bp.toString();
      bucketMap.set(key, (bucketMap.get(key) ?? new Decimal(0)).add(quantityDec));
    }

    const arr = Array.from(bucketMap.entries()).map(([price, quantity]) => ({
      price: Number(price),
      quantity: quantity.toNumber(),
    }));

    return side === 'bid'
      ? arr.sort((a, b) => b.price - a.price)
      : arr.sort((a, b) => a.price - b.price);
  };

  return { bids: bucketOneSide('bid'), asks: bucketOneSide('ask') };
}

/**
 * Calculates the difference in value saved between the current cost breakdown and a peer cost breakdown
 * for a crypto exchange transaction, considering trading fees, asset types, and whether the transaction is a buy or sell.
 *
 * @param costBreakdown - The cost breakdown for the current exchange.
 * @param peerBreakdown - The cost breakdown for the peer exchange to compare against.
 * @param isBuy - Indicates if the transaction is a buy (`true`) or sell (`false`).
 * @param base - The base asset symbol (e.g., 'BTC').
 * @param quote - The quote asset symbol (e.g., 'USD').
 * @returns An object containing:
 * - `usd`: The USD amount saved (positive if the current exchange is cheaper).
 * - `pct`: The percentage difference relative to the peer exchange's cost, or `undefined` if not applicable.
 */
export function calculateSavings(
  costBreakdown: CostBreakdown,
  peerBreakdown: CostBreakdown,
  isBuy: boolean,
  base: string,
  quote: string
): { usd: number; pct: number } {
  let currentCalc: number;
  let peerCalc: number;

  const feeAssetCurrent = costBreakdown.tradingFee?.asset?.toUpperCase?.();
  const thirdFeeAssetCurrent =
    feeAssetCurrent && feeAssetCurrent !== base && feeAssetCurrent !== quote;
  const feeAssetPeer = peerBreakdown.tradingFee?.asset?.toUpperCase?.();
  const thirdFeeAssetPeer = feeAssetPeer && feeAssetPeer !== base && feeAssetPeer !== quote;
  const sizeAsset = costBreakdown.sizeAsset;

  if (isBuy) {
    if (sizeAsset === 'base') {
      currentCalc = costBreakdown.totalTradeUsd;
      peerCalc = peerBreakdown.totalTradeUsd;
    } else {
      const usdPerBase = (costBreakdown.usdPerBase + peerBreakdown.usdPerBase) / 2;
      currentCalc =
        -(
          costBreakdown.netBaseReceived -
          (costBreakdown.tradingFee.asset !== base
            ? (costBreakdown.tradingFee.amountInBase ?? 0)
            : 0)
        ) * usdPerBase;
      peerCalc =
        -(
          peerBreakdown.netBaseReceived -
          (peerBreakdown.tradingFee.asset !== base
            ? (peerBreakdown.tradingFee.amountInBase ?? 0)
            : 0)
        ) * usdPerBase;
    }
  } else {
    if (sizeAsset === 'base') {
      currentCalc =
        costBreakdown.totalReceivedUsd - (thirdFeeAssetCurrent ? costBreakdown.tradingFee.usd : 0);
      peerCalc =
        peerBreakdown.totalReceivedUsd - (thirdFeeAssetPeer ? peerBreakdown.tradingFee.usd : 0);
    } else {
      const usdPerBase = (costBreakdown.usdPerBase + peerBreakdown.usdPerBase) / 2;
      currentCalc =
        -(
          costBreakdown.sizeBase +
          (costBreakdown.tradingFee.asset !== base
            ? (costBreakdown.tradingFee.amountInBase ?? 0)
            : 0)
        ) * usdPerBase;
      peerCalc =
        -(
          peerBreakdown.sizeBase +
          (peerBreakdown.tradingFee.asset !== base
            ? (peerBreakdown.tradingFee.amountInBase ?? 0)
            : 0)
        ) * usdPerBase;
    }
  }

  return {
    usd: isBuy ? peerCalc - currentCalc : currentCalc - peerCalc,
    pct: Math.abs((currentCalc - peerCalc) / peerCalc),
  };
}

/**
 * Counts the number of decimal places in a given number or string representation of a number.
 *
 * Handles numbers in both standard and exponential notation, and optionally keeps trailing zeros.
 *
 * @param value - The number or string to count decimal places for.
 * @param opts - Options for counting decimals.
 * @param opts.keepTrailingZeros - If true, trailing zeros in the decimal part are counted.
 * @returns The number of decimal places in the input value.
 *
 * @example
 * countDecimals(1.2300) // returns 2
 * countDecimals('1.2300', { keepTrailingZeros: true }) // returns 4
 * countDecimals('1e-5') // returns 5
 */
export function countDecimals(
  value: number | string,
  opts: { keepTrailingZeros?: boolean } = {}
): number {
  const { keepTrailingZeros = false } = opts;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;

    const s = value.toExponential(15).toLowerCase();
    const [mant, expStr] = s.split('e');
    const exp = parseInt(expStr, 10) || 0;
    const [, fracRaw = ''] = mant.split('.');

    const frac = keepTrailingZeros ? fracRaw : fracRaw.replace(/0+$/, '');
    return Math.max(0, (frac?.length || 0) - exp);
  }

  const s = value.trim().toLowerCase();
  if (!s || s === '.' || s === '+' || s === '-') return 0;

  if (s.includes('e')) {
    const [mant, expStr] = s.split('e');
    const exp = parseInt(expStr, 10) || 0;
    const [, fracRaw = ''] = mant.split('.');
    const frac = keepTrailingZeros ? fracRaw : fracRaw.replace(/0+$/, '');
    return Math.max(0, (frac?.length || 0) - exp);
  }

  const parts = s.split('.');
  if (parts.length === 1) return 0;
  const fracRaw = parts[1] ?? '';
  const frac = keepTrailingZeros ? fracRaw : fracRaw.replace(/0+$/, '');

  return frac.length;
}

/**
 * Calculates and ranks exchanges based on their cost breakdowns and trade side.
 *
 * This function evaluates a list of selected exchanges, filtering out those with errors or missing cost breakdowns.
 * It then ranks the valid exchanges using a multi-criteria comparison:
 * - The primary ranking is based on an "effective price" metric, which is fee-asset agnostic and execution-basis.
 *   - For 'buy' orders: ranks by USD paid per effective unit of base asset received (lower is better).
 *   - For 'sell' orders: ranks by negative quote received per unit of base asset sold (lower is better).
 * - If effective prices are indistinguishable (within floating-point tolerance), additional tie-breakers are applied:
 *   - For 'buy': prefers lower total USD spent, then higher net base received.
 *   - For 'sell': prefers lower total base sold, then higher total USD received.
 *   - If still tied, compares slippage rate, trading fee in USD, and raw price.
 *
 * @param selected - Array of exchange IDs to consider for ranking.
 * @param costBreakdownMap - Mapping of exchange IDs to their corresponding cost breakdowns.
 * @param errors - Optional mapping of exchange IDs to error messages; exchanges with errors are excluded.
 * @param side - The trade side, either 'buy' or 'sell', which affects ranking logic.
 * @returns An array of exchange IDs, sorted from best to worst according to the ranking criteria.
 */
export function calculateRankedExchanges(
  selected: ExchangeId[],
  costBreakdownMap: Record<ExchangeId, CostBreakdown | undefined>,
  errors: Partial<Record<ExchangeId, string | null>> = {},
  side: OrderSide
): ExchangeId[] {
  // Gather valid exchanges with cost breakdowns and no errors
  const valid = selected
    .map((id) => ({ id, bd: costBreakdownMap[id] }))
    .filter(
      (x): x is { id: ExchangeId; bd: CostBreakdown } => !!x.bd && !errors[x.id as ExchangeId]
    );

  if (!valid.length) return [];

  const EPS = 1e-12;

  /**
   * Fee-asset agnostic, execution-basis score.
   *
   * BUY  -> USD paid per *effective* unit of base kept.
   *        - If fee is base: netBaseReceived already reduced.
   *        - Else (fee in quote or third): subtract base-equivalent of feeUSD at execution basis.
   *        score = totalTradeUsd / effectiveNetBase   (lower is better)
   *
   * SELL -> (negative) quote received per unit of base sold.
   *        - If fee is quote: netQuoteReceived already reduced.
   *        - Else (fee in base or third): subtract quote-equivalent of feeUSD at execution basis.
   *        score = -(effectiveNetQuote / totalBase)   (lower is better)
   */
  const effectivePrice = (bd: CostBreakdown): number => {
    const base = bd.baseAsset?.toUpperCase?.();
    const quote = bd.quoteAsset?.toUpperCase?.();
    const feeAsset = bd.tradingFee?.asset?.toUpperCase?.();
    const feeUsd = bd.tradingFee?.usd ?? 0;
    const thirdFeeAsset = feeAsset && feeAsset !== base && feeAsset !== quote;

    // derive execution USD conversions
    const execQuoteAmt = bd.execution?.amount ?? 0; // quote notional BEFORE fee
    const execUsd = bd.execution?.usd ?? 0; // USD of that quote notional
    const usdPerQuote = execQuoteAmt > 0 ? execUsd / execQuoteAmt : 0; // USD per unit of quote at execution
    const usdPerBaseExec = (bd.averagePrice ?? 0) * usdPerQuote; // USD per unit of base at execution

    if (!(usdPerQuote > 0) || !(usdPerBaseExec > 0)) return Number.POSITIVE_INFINITY;

    if (side === 'buy') {
      const effectiveNetBase = bd.netBaseReceived - (thirdFeeAsset ? feeUsd / usdPerBaseExec : 0); // base after fee
      if (!(effectiveNetBase > EPS)) return Number.POSITIVE_INFINITY;
      return bd.totalTradeUsd / effectiveNetBase; // USD spent per effective base
    } else {
      if (!(bd.totalBase > EPS)) return Number.POSITIVE_INFINITY;
      const effectiveNetQuote = bd.netQuoteReceived - (thirdFeeAsset ? feeUsd / usdPerQuote : 0); // quote after fee
      return -(effectiveNetQuote / bd.totalBase); // negative quote received per base sold
    }
  };

  /**
   * Determines whether two numbers are almost equal, considering floating-point precision errors.
   *
   * The comparison uses a tolerance of `1e-9` multiplied by the maximum of 1 and the smaller absolute value of the two numbers.
   * This approach helps to avoid issues with very small or very large numbers.
   *
   * @param a - The first number to compare.
   * @param b - The second number to compare.
   * @returns `true` if the numbers are almost equal within the calculated tolerance, otherwise `false`.
   */
  const checkIfAlmostEqual = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.min(Math.abs(a), Math.abs(b)));

  /**
   * Compares two `CostBreakdown` objects to determine which is preferable based on a series of criteria:
   *
   * 1. Prefers the lower slippage rate.
   * 2. If slippage rates are almost equal, prefers the lower trading fee in USD.
   * 3. If both slippage and trading fees are almost equal, prefers the better raw price:
   *    - For 'buy' side, prefers the lower price.
   *    - For 'sell' side, prefers the higher price.
   *
   * @param a - The first `CostBreakdown` object to compare.
   * @param b - The second `CostBreakdown` object to compare.
   * @returns A negative number if `a` is preferable, a positive number if `b` is preferable, or zero if they are considered equal.
   */
  const tieBreak = (a: CostBreakdown, b: CostBreakdown) => {
    // 1) Lower slippage rate
    const sA = a.slippage.rate ?? 0;
    const sB = b.slippage.rate ?? 0;
    if (!checkIfAlmostEqual(sA, sB)) return sA - sB;

    // 2) Lower fee USD
    const fA = a.tradingFee.usd ?? 0;
    const fB = b.tradingFee.usd ?? 0;
    if (!checkIfAlmostEqual(fA, fB)) return fA - fB;

    // 3) Better raw price (lower for buys, higher for sells)
    const pA = a.averagePrice ?? (side === 'buy' ? Infinity : -Infinity);
    const pB = b.averagePrice ?? (side === 'buy' ? Infinity : -Infinity);
    return side === 'buy' ? pA - pB : pB - pA;
  };

  /**
   * Comparator function for sorting exchange cost breakdowns.
   *
   * Compares two exchanges (`A` and `B`) based on their effective price, with additional
   * tie-breaking logic depending on the trade side (`buy` or `sell`). Lower effective price is preferred.
   * If prices are almost equal, further comparison is performed using trade USD amounts and base/quote quantities:
   *
   * - For `'buy'` side:
   *   - Prefers lower total USD spent (`totalTradeUsd`).
   *   - If still tied, prefers higher net base received (`netBaseReceived`).
   * - For `'sell'` side:
   *   - Prefers lower total base sold (`totalBase`).
   *   - If still tied, prefers higher total USD received (`totalReceivedUsd`).
   *
   * If all criteria are almost equal, falls back to a custom `tieBreak` function.
   *
   * @param A - First exchange object containing `id` and cost breakdown (`bd`).
   * @param B - Second exchange object containing `id` and cost breakdown (`bd`).
   * @returns A negative number if `A` is preferred, positive if `B` is preferred, or zero if they are considered equal.
   */
  const cmp = (
    A: { id: ExchangeId; bd: CostBreakdown },
    B: { id: ExchangeId; bd: CostBreakdown }
  ) => {
    const a = effectivePrice(A.bd);
    const b = effectivePrice(B.bd);
    if (!checkIfAlmostEqual(a, b)) return a - b;

    // If the effective prices are indistinguishable, prefer the one
    // that also has better native quantities explicitly (extra safety).
    if (side === 'buy') {
      const aSpent = A.bd.totalTradeUsd ?? 0;
      const bSpent = B.bd.totalTradeUsd ?? 0;
      if (!checkIfAlmostEqual(aSpent, bSpent)) return aSpent - bSpent;
      const aRecv = A.bd.netBaseReceived ?? 0;
      const bRecv = B.bd.netBaseReceived ?? 0;
      if (!checkIfAlmostEqual(aRecv, bRecv)) return bRecv - aRecv;
    } else {
      const aBase = A.bd.totalBase ?? 0;
      const bBase = B.bd.totalBase ?? 0;
      if (!checkIfAlmostEqual(aBase, bBase)) return aBase - bBase;
      const aRecv = A.bd.totalReceivedUsd ?? 0;
      const bRecv = B.bd.totalReceivedUsd ?? 0;
      if (!checkIfAlmostEqual(aRecv, bRecv)) return bRecv - aRecv;
    }

    return tieBreak(A.bd, B.bd);
  };

  valid.sort(cmp); // best -> worst
  return valid.map((v) => v.id);
}

/**
 * Generates a trade URL for a given cryptocurrency pair on a specified exchange.
 *
 * @param base - The base currency symbol (e.g., 'BTC').
 * @param quote - The quote currency symbol (e.g., 'USDT').
 * @param exchangeName - The name of the exchange (e.g., 'binance', 'bybit', 'coinbase', 'okx').
 * @returns The URL string to the trading page for the specified pair on the given exchange,
 *          or `null` if base or quote is missing, or `undefined` if the exchange is not supported.
 */
export function getExchangeTradeHref(base: string, quote: string, exchangeName: string) {
  if (!base || !quote) return null;
  base = base.toUpperCase();
  quote = quote.toUpperCase();

  switch (exchangeName.toLowerCase()) {
    case 'binance':
      return `https://www.binance.com/en/trade/${encodeURIComponent(base)}_${encodeURIComponent(quote)}?ref=AWGBMTXC&type=spot`;
    case 'bybit':
      return `https://www.bybit.com/en/trade/spot/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`;
    case 'coinbase':
      return `https://www.coinbase.com/advanced-trade/spot/${encodeURIComponent(base)}-${encodeURIComponent(quote)}`;
    case 'okx':
      return `https://www.okx.com/trade-spot/${encodeURIComponent(base)}-${encodeURIComponent(quote)}`;
    default:
      return undefined;
  }
}
