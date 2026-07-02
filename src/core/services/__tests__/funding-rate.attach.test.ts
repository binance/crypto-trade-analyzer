import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachFunding, fundingRateService } from '../funding-rate';
import type { FundingInfo } from '../funding-rate';
import type { CostBreakdown } from '../../interfaces/fee-config';

function makeBd(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    exchange: 'Binance',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    sizeAsset: 'base',
    side: 'buy',
    sizeBase: 1,
    averagePrice: 10_000,
    averagePriceUsd: 10_000,
    referencePrice: 10_000,
    usdPerBase: 10_000,
    usdPerQuote: 1,
    feeRateAnalysis: [],
    execution: { amount: 10_000, asset: 'USDT', usd: 10_000 },
    tradingFee: { amount: 0, asset: 'USDT', usd: 0, amountInBase: 0, amountInQuote: 0 },
    slippage: { amount: 0, asset: 'USDT', usd: 0, rate: 0 },
    netBaseReceived: 1,
    netQuoteReceived: 0,
    totalQuote: 10_000,
    totalBase: 0,
    totalReceivedUsd: 10_000,
    totalSpentUsd: 10_000,
    totalTradeUsd: 10_000,
    ...overrides,
  };
}

function mockFunding(info: FundingInfo | undefined) {
  return vi.spyOn(fundingRateService, 'getFunding').mockResolvedValue(info);
}

afterEach(() => vi.restoreAllMocks());

describe('attachFunding — holding-period guards', () => {
  it('no-op when holdingHours is undefined (spot)', async () => {
    const spy = mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd();
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', undefined);
    expect(bd.funding).toBeUndefined();
    expect(bd.fundingMissing).toBeUndefined();
    expect(bd.holdingPeriodHours).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('no-op when holdingHours is negative', async () => {
    const spy = mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd();
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', -5);
    expect(bd.funding).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('stamps holdingPeriodHours but adds no funding when holdingHours is 0', async () => {
    const spy = mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd();
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 0);
    expect(bd.holdingPeriodHours).toBe(0);
    expect(bd.funding).toBeUndefined();
    expect(bd.fundingMissing).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('attachFunding — funding unavailable', () => {
  it('sets fundingMissing and stamps period when fetch returns undefined', async () => {
    mockFunding(undefined);
    const bd = makeBd();
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 8);
    expect(bd.fundingMissing).toBe(true);
    expect(bd.funding).toBeUndefined();
    expect(bd.holdingPeriodHours).toBe(8);
  });
});

describe('attachFunding — success', () => {
  it('attaches a signed funding item for a long paying positive funding', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd({ side: 'buy' });
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 8);
    expect(bd.funding).toBeDefined();
    expect(bd.funding!.usd).toBeCloseTo(1, 8);
    expect(bd.funding!.rate).toBe(0.0001);
    expect(bd.funding!.asset).toBe('USDT');
    expect(bd.fundingMissing).toBeUndefined();
  });

  it('stamps fundingIntervalHours from the fetched funding info', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 4 });
    const bd = makeBd();
    await attachFunding(bd, 'Bybit', 'BTCUSDT', 'buy', 8);
    expect(bd.fundingIntervalHours).toBe(4);
  });

  it('short receiving positive funding gets a negative (credit) funding item', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd({ side: 'sell' });
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'sell', 8);
    expect(bd.funding!.usd).toBeCloseTo(-1, 8);
  });

  it('converts funding USD to quote units via usdPerQuote', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd({ usdPerQuote: 2 });
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 8);
    expect(bd.funding!.usd).toBeCloseTo(1, 8);
    expect(bd.funding!.amount).toBeCloseTo(0.5, 8);
  });

  it('funding amount is 0 when usdPerQuote is 0 (no divide-by-zero)', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd({ usdPerQuote: 0 });
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 8);
    expect(bd.funding!.amount).toBe(0);
  });

  it('prorates over a partial holding period', async () => {
    mockFunding({ ratePerInterval: 0.0001, intervalHours: 8 });
    const bd = makeBd();
    await attachFunding(bd, 'Binance', 'BTCUSDT', 'buy', 4);
    expect(bd.funding!.usd).toBeCloseTo(0.5, 8);
  });
});
