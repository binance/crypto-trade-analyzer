import { describe, it, expect, vi } from 'vitest';
import {
  parsePair,
  normalizePairText,
  isStablecoin,
  fiatNumberFormat,
  cryptoNumberFormat,
  percentageNumberFormat,
  mapOrderBook,
  bucketizeOrderBook,
  inferBookTick,
  countDecimals,
  formatTick,
  buildTickOptions,
  computeEffectiveDisplayTick,
  computeMismatchDisplayTick,
  calculateSavings,
  calculateRankedExchanges,
  getExchangeTradeHref,
  withRetry,
  eventEpochMs,
  percentile,
} from '../utils';
import type { CostBreakdown } from '../../core/interfaces/fee-config';

describe('percentile', () => {
  it('returns NaN for empty input and the single value for one element', () => {
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('computes the median (p50) with linear interpolation', () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('does not require sorted input', () => {
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
  });

  it('interpolates p95 between straddling ranks', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(percentile(vals, 0.95)).toBeCloseTo(10.5, 6);
  });

  it('clamps p to [0,1] (min and max ranks)', () => {
    expect(percentile([5, 1, 9], -1)).toBe(1);
    expect(percentile([5, 1, 9], 2)).toBe(9);
  });
});

describe('eventEpochMs', () => {
  it('converts a DOM event timeStamp to epoch ms via performance.timeOrigin', () => {
    const evt = { timeStamp: 1234.5 };
    expect(eventEpochMs(evt)).toBeCloseTo(performance.timeOrigin + 1234.5, 3);
  });

  it('falls back to a Date.now()-like value when timeStamp is missing or non-positive', () => {
    const before = Date.now();
    const got = eventEpochMs({});
    const after = Date.now();
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);

    const gotZero = eventEpochMs({ timeStamp: 0 });
    expect(gotZero).toBeGreaterThanOrEqual(before);
  });
});

describe('parsePair', () => {
  it('splits slash-delimited pairs', () => {
    expect(parsePair('BTC/USDT')).toEqual({ base: 'BTC', quote: 'USDT' });
  });

  it('splits dash-delimited pairs', () => {
    expect(parsePair('ETH-USD')).toEqual({ base: 'ETH', quote: 'USD' });
  });

  it('uppercases both sides', () => {
    expect(parsePair('btc/usdt')).toEqual({ base: 'BTC', quote: 'USDT' });
  });

  it('handles missing quote gracefully', () => {
    const { base, quote } = parsePair('BTC');
    expect(base).toBe('BTC');
    expect(quote).toBe('');
  });
});

describe('normalizePairText', () => {
  it('strips non-alphanumeric and lowercases', () => {
    expect(normalizePairText('BTC/USDT')).toBe('btcusdt');
    expect(normalizePairText('ETH-USD')).toBe('ethusd');
    expect(normalizePairText('SOL / USDC')).toBe('solusdc');
  });

  it('returns empty string for fully non-alphanumeric input', () => {
    expect(normalizePairText('---')).toBe('');
  });
});

describe('isStablecoin', () => {
  it('recognizes known stablecoins case-insensitively', () => {
    expect(isStablecoin('USDT')).toBe(true);
    expect(isStablecoin('usdc')).toBe(true);
    expect(isStablecoin('UsD')).toBe(true);
  });

  it('returns false for non-stablecoins', () => {
    expect(isStablecoin('BTC')).toBe(false);
    expect(isStablecoin('ETH')).toBe(false);
  });

  it('is null-safe', () => {
    expect(isStablecoin(null)).toBe(false);
    expect(isStablecoin(undefined)).toBe(false);
    expect(isStablecoin('')).toBe(false);
  });
});

describe('fiatNumberFormat', () => {
  it('formats with 2 decimals by default', () => {
    expect(fiatNumberFormat(1234.5)).toBe('1,234.50');
  });

  it('returns — for non-finite values', () => {
    expect(fiatNumberFormat(NaN)).toBe('—');
    expect(fiatNumberFormat(Infinity)).toBe('—');
  });

  it('compacts large numbers', () => {
    expect(fiatNumberFormat(1_500_000, { compact: true })).toBe('1.500M');
    expect(fiatNumberFormat(12_000, { compact: true })).toBe('12K');
  });

  it('respects decimals override', () => {
    expect(fiatNumberFormat(1.23456, { decimals: 4 })).toBe('1.2346');
  });

  it('formats zero as 0.00', () => {
    expect(fiatNumberFormat(0)).toBe('0.00');
  });
});

describe('cryptoNumberFormat', () => {
  it('formats numbers >= 1 with 4 decimals by default', () => {
    expect(cryptoNumberFormat(1.5)).toBe('1.5000');
  });

  it('returns — for non-finite', () => {
    expect(cryptoNumberFormat(NaN)).toBe('—');
    expect(cryptoNumberFormat(-Infinity)).toBe('—');
  });

  it('returns tinyText for sub-threshold values', () => {
    expect(cryptoNumberFormat(1e-10)).toBe('<1e-8');
  });

  it('returns 0.0000 for zero', () => {
    expect(cryptoNumberFormat(0)).toBe('0.0000');
  });

  it('compacts large numbers', () => {
    const r = cryptoNumberFormat(12345, { compact: true });
    expect(r).toBe('12.345K');
  });

  it('respects maxSig with higher maxDecimals', () => {
    const r = cryptoNumberFormat(0.001234567, { maxSig: 3, minDecimals: 5, maxDecimals: 8 });
    expect(r).toBe('0.00123');
  });
});

describe('percentageNumberFormat', () => {
  it('formats fractional rate as percentage with 4 decimals', () => {
    expect(percentageNumberFormat(0.001)).toBe('0.1000%');
    expect(percentageNumberFormat(0)).toBe('0.0000%');
    expect(percentageNumberFormat(0.00001)).toBe('0.0010%');
  });
});

describe('mapOrderBook', () => {
  it('coerces price/quantity to numbers', () => {
    const book = {
      bids: [{ price: '100' as unknown as number, quantity: '2' as unknown as number }],
      asks: [{ price: '101' as unknown as number, quantity: '1' as unknown as number }],
    };
    const mapped = mapOrderBook(book);
    expect(typeof mapped.bids[0].price).toBe('number');
    expect(mapped.bids[0].price).toBe(100);
    expect(mapped.asks[0].quantity).toBe(1);
  });

  it('handles undefined bids/asks gracefully', () => {
    const mapped = mapOrderBook({ bids: undefined as never, asks: undefined as never });
    expect(mapped.bids).toEqual([]);
    expect(mapped.asks).toEqual([]);
  });
});

describe('bucketizeOrderBook', () => {
  const book = {
    bids: [
      { price: 100.5, quantity: 1 },
      { price: 100.3, quantity: 2 },
      { price: 100.1, quantity: 3 },
    ],
    asks: [
      { price: 100.6, quantity: 1 },
      { price: 100.8, quantity: 2 },
      { price: 101.1, quantity: 3 },
    ],
  };

  it('returns original book unchanged when tick <= 0', () => {
    expect(bucketizeOrderBook(book, 0)).toBe(book);
    expect(bucketizeOrderBook(book, -1)).toBe(book);
  });

  it('merges bid levels into same bucket (floor)', () => {
    const result = bucketizeOrderBook(book, 1);
    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].price).toBe(100);
    expect(result.bids[0].quantity).toBe(6);
  });

  it('merges ask levels into same bucket (ceil)', () => {
    const result = bucketizeOrderBook(book, 1);
    const prices = result.asks.map((a) => a.price);
    expect(prices).toContain(101);
    expect(prices).toContain(102);
    expect(result.asks.find((a) => a.price === 101)?.quantity).toBe(3);
  });

  it('sorts bids descending and asks ascending', () => {
    const result = bucketizeOrderBook(book, 0.5);
    const bidPrices = result.bids.map((b) => b.price);
    const askPrices = result.asks.map((a) => a.price);
    expect(bidPrices).toEqual([...bidPrices].sort((a, b) => b - a));
    expect(askPrices).toEqual([...askPrices].sort((a, b) => a - b));
  });
});

describe('inferBookTick', () => {
  it('infers the smallest gap between distinct prices across both sides', () => {
    const book = {
      bids: [
        { price: 0.19263, quantity: 1 },
        { price: 0.19262, quantity: 1 },
        { price: 0.19261, quantity: 1 },
      ],
      asks: [
        { price: 0.19264, quantity: 1 },
        { price: 0.19266, quantity: 1 },
      ],
    };
    expect(inferBookTick(book)).toBeCloseTo(0.00001, 10);
  });

  it('ignores the misleading advertised tick (uses real book spacing)', () => {
    const book = {
      bids: [
        { price: 0.192, quantity: 1 },
        { price: 0.19199, quantity: 1 },
      ],
      asks: [{ price: 0.19201, quantity: 1 }],
    };
    expect(inferBookTick(book)).toBeCloseTo(0.00001, 10);
  });

  it('returns undefined when fewer than two distinct prices', () => {
    expect(inferBookTick({ bids: [], asks: [] })).toBeUndefined();
    expect(
      inferBookTick({ bids: [{ price: 1, quantity: 1 }], asks: [{ price: 1, quantity: 1 }] })
    ).toBeUndefined();
  });

  it('skips non-finite and non-positive prices', () => {
    const book = {
      bids: [
        { price: 0, quantity: 1 },
        { price: 10, quantity: 1 },
      ],
      asks: [
        { price: 11, quantity: 1 },
        { price: NaN, quantity: 1 },
      ],
    };

    expect(inferBookTick(book)).toBe(1);
  });
});

describe('countDecimals', () => {
  it('counts decimals for plain floats', () => {
    expect(countDecimals(1.5)).toBe(1);
    expect(countDecimals(1.005)).toBe(3);
    expect(countDecimals(100)).toBe(0);
  });

  it('handles exponential notation', () => {
    expect(countDecimals(1e-5)).toBe(5);
    expect(countDecimals('1e-3')).toBe(3);
    expect(countDecimals('1.5e2')).toBe(0);
  });

  it('trims trailing zeros by default', () => {
    expect(countDecimals(1.23)).toBe(2);
    expect(countDecimals('1.2300')).toBe(2);
  });

  it('keeps trailing zeros when flag set', () => {
    expect(countDecimals('1.2300', { keepTrailingZeros: true })).toBe(4);
  });

  it('returns 0 for non-finite numbers', () => {
    expect(countDecimals(NaN)).toBe(0);
    expect(countDecimals(Infinity)).toBe(0);
  });

  it('returns 0 for degenerate strings', () => {
    expect(countDecimals('')).toBe(0);
    expect(countDecimals('.')).toBe(0);
    expect(countDecimals('-')).toBe(0);
  });
});

describe('formatTick', () => {
  it('formats sub-1 ticks without trailing zeros', () => {
    expect(formatTick(0.0001)).toBe('0.0001');
    expect(formatTick(0.001)).toBe('0.001');
    expect(formatTick(0.01)).toBe('0.01');
    expect(formatTick(0.1)).toBe('0.1');
  });

  it('formats integer ticks without decimals', () => {
    expect(formatTick(1)).toBe('1');
    expect(formatTick(10)).toBe('10');
  });

  it('returns placeholder for invalid ticks', () => {
    expect(formatTick(0)).toBe('—');
    expect(formatTick(-1)).toBe('—');
    expect(formatTick(NaN)).toBe('—');
  });
});

describe('buildTickOptions', () => {
  it('offers only Auto and coarser when no finer native tick is given', () => {
    const opts = buildTickOptions(0.01);
    expect(opts.map((o) => o.value)).toEqual([1, 10, 100, 1000]);
    // The base multiplier (1) renders as the plain tick value, not an "Auto (...)" label.
    expect(opts.find((o) => o.value === 1)?.label).toBe('0.01');
    expect(opts.find((o) => o.value === 10)?.label).toBe('0.1');
    expect(opts.find((o) => o.value === 100)?.label).toBe('1');
  });

  it('exposes finer options down to the finest supported native tick', () => {
    const opts = buildTickOptions(0.01, 0.0001);
    expect(opts.map((o) => o.value)).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
    expect(opts.find((o) => o.value === 0.01)?.label).toBe('0.0001');
    expect(opts.find((o) => o.value === 0.1)?.label).toBe('0.001');
    expect(opts.find((o) => o.value === 1)?.label).toBe('0.01');
  });

  it('drops finer options that would go below the finest native tick', () => {
    const opts = buildTickOptions(0.01, 0.001);
    expect(opts.some((o) => o.value === 0.1)).toBe(true);
    expect(opts.some((o) => o.value === 0.01)).toBe(false);
  });

  it('drops coarse multiples above the sensible max', () => {
    const opts = buildTickOptions(1000);
    expect(opts.some((o) => o.value === 1000)).toBe(true);
  });

  it('returns a single Auto option for invalid base ticks', () => {
    expect(buildTickOptions(0)).toEqual([{ label: 'Auto', value: 1 }]);
    expect(buildTickOptions(NaN)).toEqual([{ label: 'Auto', value: 1 }]);
  });
});

describe('computeEffectiveDisplayTick', () => {
  it('returns undefined when no base grid is known', () => {
    expect(computeEffectiveDisplayTick(undefined, 0.1, 0.0001)).toBeUndefined();
    expect(computeEffectiveDisplayTick(0, 0.1, 0.0001)).toBeUndefined();
  });

  it('returns the base tick unchanged for Auto (multiplier 1)', () => {
    expect(computeEffectiveDisplayTick(0.01, 1, 0.0001)).toBe(0.01);
    expect(computeEffectiveDisplayTick(0.01, 1, undefined)).toBe(0.01);
  });

  it('applies coarser multipliers directly (native tick irrelevant when coarsening)', () => {
    expect(computeEffectiveDisplayTick(0.01, 10, 0.0001)).toBeCloseTo(0.1, 12);
    expect(computeEffectiveDisplayTick(0.01, 100, 0.0001)).toBeCloseTo(1, 12);
  });

  it('clamps finer multipliers UP to the exchange native tick', () => {
    expect(computeEffectiveDisplayTick(0.01, 0.01, 0.0001)).toBeCloseTo(0.0001, 12);
    expect(computeEffectiveDisplayTick(0.01, 0.01, 0.001)).toBeCloseTo(0.001, 12);
  });

  it('uses the raw target when native tick is unknown', () => {
    expect(computeEffectiveDisplayTick(0.01, 0.1, undefined)).toBeCloseTo(0.001, 12);
  });
});

describe('computeMismatchDisplayTick', () => {
  it('returns undefined when no inferred tick is known', () => {
    expect(computeMismatchDisplayTick(undefined, 1)).toBeUndefined();
    expect(computeMismatchDisplayTick(0, 10)).toBeUndefined();
  });

  it('returns the inferred tick unchanged for Auto (multiplier 1)', () => {
    expect(computeMismatchDisplayTick(0.0001, 1)).toBeCloseTo(0.0001, 12);
  });

  it('applies coarser multipliers on top of the inferred tick', () => {
    expect(computeMismatchDisplayTick(0.0001, 10)).toBeCloseTo(0.001, 12);
    expect(computeMismatchDisplayTick(0.0001, 100)).toBeCloseTo(0.01, 12);
    expect(computeMismatchDisplayTick(0.0001, 1000)).toBeCloseTo(0.1, 12);
  });

  it('never returns a display tick finer than the inferred (cost) tick', () => {
    expect(computeMismatchDisplayTick(0.0001, 0.01)).toBeCloseTo(0.0001, 12);
    expect(computeMismatchDisplayTick(0.0001, 0.1)).toBeCloseTo(0.0001, 12);
  });
});

describe('getExchangeTradeHref', () => {
  it('returns null when base or quote missing', () => {
    expect(getExchangeTradeHref('', 'USDT', 'binance')).toBeNull();
    expect(getExchangeTradeHref('BTC', '', 'binance')).toBeNull();
    expect(getExchangeTradeHref('', 'USDT', 'binance', 'futures')).toBeNull();
    expect(getExchangeTradeHref('BTC', '', 'binance', 'futures')).toBeNull();
  });

  it('returns undefined for unknown exchange in either market', () => {
    expect(getExchangeTradeHref('BTC', 'USDT', 'unknown_exchange')).toBeUndefined();
    expect(getExchangeTradeHref('BTC', 'USDT', 'unknown_exchange', 'futures')).toBeUndefined();
  });

  it('uppercases the base and quote symbols', () => {
    expect(getExchangeTradeHref('btc', 'usdt', 'binance')).toBe(
      'https://www.binance.com/en/trade/BTC_USDT?ref=AWGBMTXC&type=spot'
    );
    expect(getExchangeTradeHref('btc', 'usdt', 'binance', 'futures')).toBe(
      'https://www.binance.com/en/futures/BTCUSDT?ref=AWGBMTXC'
    );
  });

  describe('spot market (default)', () => {
    it('builds Binance spot URL', () => {
      expect(getExchangeTradeHref('BTC', 'USDT', 'binance')).toBe(
        'https://www.binance.com/en/trade/BTC_USDT?ref=AWGBMTXC&type=spot'
      );
    });

    it('builds Bybit spot URL', () => {
      expect(getExchangeTradeHref('ETH', 'USDT', 'bybit')).toBe(
        'https://www.bybit.com/en/trade/spot/ETH/USDT'
      );
    });

    it('builds Coinbase spot URL', () => {
      expect(getExchangeTradeHref('BTC', 'USD', 'coinbase')).toBe(
        'https://www.coinbase.com/advanced-trade/spot/BTC-USD'
      );
    });

    it('builds OKX spot URL', () => {
      expect(getExchangeTradeHref('BTC', 'USDT', 'okx')).toBe(
        'https://www.okx.com/trade-spot/BTC-USDT'
      );
    });

    it('defaults to spot when marketType is omitted', () => {
      expect(getExchangeTradeHref('BTC', 'USDT', 'binance')).toBe(
        getExchangeTradeHref('BTC', 'USDT', 'binance', 'spot')
      );
    });
  });

  describe('futures market', () => {
    it('builds Binance futures URL', () => {
      expect(getExchangeTradeHref('BTC', 'USDT', 'binance', 'futures')).toBe(
        'https://www.binance.com/en/futures/BTCUSDT?ref=AWGBMTXC'
      );
    });

    it('builds Bybit USDT perpetual URL', () => {
      expect(getExchangeTradeHref('ETH', 'USDT', 'bybit', 'futures')).toBe(
        'https://www.bybit.com/en/trade/usdt/ETHUSDT'
      );
    });

    it('builds Bybit USDC perpetual URL', () => {
      expect(getExchangeTradeHref('BTC', 'USDC', 'bybit', 'futures')).toBe(
        'https://www.bybit.com/en/trade/futures/usdc/BTC-PERP'
      );
    });

    it('returns undefined for Bybit futures with an unsupported quote', () => {
      expect(getExchangeTradeHref('BTC', 'DAI', 'bybit', 'futures')).toBeUndefined();
    });

    it('builds OKX swap URL', () => {
      expect(getExchangeTradeHref('BTC', 'USDT', 'okx', 'futures')).toBe(
        'https://www.okx.com/trade-swap/BTC-USDT-swap'
      );
    });

    it('returns undefined for Coinbase futures (unsupported)', () => {
      expect(getExchangeTradeHref('BTC', 'USD', 'coinbase', 'futures')).toBeUndefined();
    });
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return Promise.resolve('done');
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 0 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when retryCondition returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, retryCondition: () => false })
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

function makeBd(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    exchange: 'Test',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    sizeAsset: 'base',
    side: 'buy',
    sizeBase: 1,
    averagePrice: 100,
    averagePriceUsd: 100,
    referencePrice: 100,
    usdPerBase: 100,
    usdPerQuote: 1,
    feeRateAnalysis: [],
    execution: { amount: 100, asset: 'USDT', usd: 100 },
    tradingFee: { amount: 0.1, asset: 'BTC', usd: 10, amountInBase: 0.1, amountInQuote: 10 },
    slippage: { amount: 0, asset: 'USDT', usd: 0, rate: 0 },
    netBaseReceived: 0.9,
    netQuoteReceived: 0,
    totalQuote: 110,
    totalBase: 0,
    totalReceivedUsd: 90,
    totalSpentUsd: 110,
    totalTradeUsd: 110,
    ...overrides,
  };
}

describe('calculateRankedExchanges', () => {
  it('returns empty for no valid breakdowns', () => {
    expect(calculateRankedExchanges([], {} as never, {}, 'buy')).toEqual([]);
  });

  it('excludes exchanges with errors', () => {
    const map = { Binance: makeBd({ exchange: 'Binance' }), OKX: makeBd({ exchange: 'OKX' }) };
    const errors = { OKX: 'network error' };
    const ranked = calculateRankedExchanges(
      ['Binance', 'OKX'] as never,
      map as never,
      errors,
      'buy'
    );
    expect(ranked).toEqual(['Binance']);
  });

  it('ranks buy side by ascending totalTradeUsd (cheaper first)', () => {
    const cheap = makeBd({
      exchange: 'Cheap',
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const expensive = makeBd({
      exchange: 'Expensive',
      totalTradeUsd: 200,
      execution: { amount: 200, asset: 'USDT', usd: 200 },
    });
    const map = { Cheap: cheap, Expensive: expensive };
    const ranked = calculateRankedExchanges(
      ['Cheap', 'Expensive'] as never,
      map as never,
      {},
      'buy'
    );
    expect(ranked[0]).toBe('Cheap');
  });

  it('ranks sell side by descending received', () => {
    const more = makeBd({
      exchange: 'More',
      side: 'sell',
      sizeAsset: 'base',
      totalReceivedUsd: 200,
      execution: { amount: 200, asset: 'USDT', usd: 200 },
      tradingFee: { amount: 0, asset: 'USDT', usd: 0, amountInBase: 0, amountInQuote: 0 },
    });
    const less = makeBd({
      exchange: 'Less',
      side: 'sell',
      sizeAsset: 'base',
      totalReceivedUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
      tradingFee: { amount: 0, asset: 'USDT', usd: 0, amountInBase: 0, amountInQuote: 0 },
    });
    const map = { More: more, Less: less };
    const ranked = calculateRankedExchanges(['More', 'Less'] as never, map as never, {}, 'sell');
    expect(ranked[0]).toBe('More');
  });
});

describe('calculateSavings (spot)', () => {
  it('buy/base: positive savings when current is cheaper', () => {
    const current = makeBd({
      exchange: 'Current',
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const peer = makeBd({
      exchange: 'Peer',
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const { usd } = calculateSavings(current, peer, true, 'BTC', 'USDT');
    expect(usd).toBeGreaterThan(0);
  });

  it('buy/base: negative savings when current is more expensive', () => {
    const current = makeBd({
      exchange: 'Current',
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const peer = makeBd({
      exchange: 'Peer',
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const { usd } = calculateSavings(current, peer, true, 'BTC', 'USDT');
    expect(usd).toBeLessThan(0);
  });

  it('symmetry: swapping current/peer flips the sign', () => {
    const a = makeBd({
      exchange: 'A',
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const b = makeBd({
      exchange: 'B',
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const { usd: ab } = calculateSavings(a, b, true, 'BTC', 'USDT');
    const { usd: ba } = calculateSavings(b, a, true, 'BTC', 'USDT');
    expect(ab).toBeCloseTo(-ba, 8);
  });

  it('zero savings for identical breakdowns', () => {
    const bd = makeBd();
    const { usd } = calculateSavings(bd, bd, true, 'BTC', 'USDT');
    expect(usd).toBe(0);
  });
});
