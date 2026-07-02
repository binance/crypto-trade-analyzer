import { describe, it, expect } from 'vitest';
import { calculateRankedExchanges, calculateSavings } from '../utils';
import type { CostBreakdown, CostItem } from '../../core/interfaces/fee-config';

function futuresBd(
  exchange: string,
  fundingUsd: number | undefined,
  opts: Partial<CostBreakdown> = {}
): CostBreakdown {
  const funding: CostItem | undefined =
    fundingUsd === undefined
      ? undefined
      : { amount: fundingUsd, asset: 'USDT', usd: fundingUsd, rate: 0.0001 };
  return {
    exchange,
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
    funding,
    holdingPeriodHours: funding ? 8 : undefined,
    netBaseReceived: 0.9,
    netQuoteReceived: 0,
    totalQuote: 110,
    totalBase: 0,
    totalReceivedUsd: 90,
    totalSpentUsd: 110,
    totalTradeUsd: 110,
    ...opts,
  };
}

describe('calculateRankedExchanges — funding fold-in (buy)', () => {
  it('buy/base: exchange with lower funding cost ranks first when trade cost is equal', () => {
    const lowFunding = futuresBd('Low', 1);
    const highFunding = futuresBd('High', 5);
    const map = { Low: lowFunding, High: highFunding };
    const ranked = calculateRankedExchanges(['High', 'Low'] as never, map as never, {}, 'buy');
    expect(ranked[0]).toBe('Low');
  });

  it('buy/base: a funding credit (negative) beats a funding cost', () => {
    const credit = futuresBd('Credit', -2);
    const cost = futuresBd('Cost', 2);
    const map = { Credit: credit, Cost: cost };
    const ranked = calculateRankedExchanges(['Cost', 'Credit'] as never, map as never, {}, 'buy');
    expect(ranked[0]).toBe('Credit');
  });

  it('buy/base: funding can flip ranking vs a cheaper-execution peer', () => {
    const cheapExecBigFunding = futuresBd('A', 20, {
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const pricierNoFunding = futuresBd('B', 0, {
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const map = { A: cheapExecBigFunding, B: pricierNoFunding };
    const ranked = calculateRankedExchanges(['A', 'B'] as never, map as never, {}, 'buy');
    expect(ranked[0]).toBe('B');
  });
});

describe('calculateRankedExchanges — funding fold-in (sell)', () => {
  it('sell/base: exchange receiving funding (negative cost) ranks first', () => {
    const receivesFunding = futuresBd('Recv', -2, {
      side: 'sell',
      totalReceivedUsd: 100,
      tradingFee: { amount: 0, asset: 'USDT', usd: 0, amountInBase: 0, amountInQuote: 0 },
    });
    const paysFunding = futuresBd('Pays', 2, {
      side: 'sell',
      totalReceivedUsd: 100,
      tradingFee: { amount: 0, asset: 'USDT', usd: 0, amountInBase: 0, amountInQuote: 0 },
    });
    const map = { Recv: receivesFunding, Pays: paysFunding };
    const ranked = calculateRankedExchanges(['Pays', 'Recv'] as never, map as never, {}, 'sell');
    expect(ranked[0]).toBe('Recv');
  });
});

describe('funding fold-in — spot invariance', () => {
  it('ranking is identical whether funding is undefined or absent', () => {
    const a = futuresBd('A', undefined, {
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const b = futuresBd('B', undefined, {
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const map = { A: a, B: b };
    const ranked = calculateRankedExchanges(['B', 'A'] as never, map as never, {}, 'buy');
    expect(ranked).toEqual(['A', 'B']);
  });

  it('savings between two no-funding breakdowns equals plain cost difference', () => {
    const current = futuresBd('Cur', undefined, {
      totalTradeUsd: 100,
      execution: { amount: 100, asset: 'USDT', usd: 100 },
    });
    const peer = futuresBd('Peer', undefined, {
      totalTradeUsd: 110,
      execution: { amount: 110, asset: 'USDT', usd: 110 },
    });
    const { usd } = calculateSavings(current, peer, true, 'BTC', 'USDT');
    expect(usd).toBeCloseTo(10, 8);
  });
});

describe('calculateSavings — funding fold-in', () => {
  it('buy: funding cost on current reduces savings vs peer', () => {
    const base = { totalTradeUsd: 100, execution: { amount: 100, asset: 'USDT', usd: 100 } };
    const currentNoFunding = futuresBd('Cur', 0, base);
    const currentWithFunding = futuresBd('Cur', 5, base);
    const peer = futuresBd('Peer', 0, base);

    const withoutFunding = calculateSavings(currentNoFunding, peer, true, 'BTC', 'USDT').usd;
    const withFunding = calculateSavings(currentWithFunding, peer, true, 'BTC', 'USDT').usd;
    expect(withFunding).toBeCloseTo(withoutFunding - 5, 6);
  });

  it('buy: funding sign matters — a credit improves savings', () => {
    const base = { totalTradeUsd: 100, execution: { amount: 100, asset: 'USDT', usd: 100 } };
    const currentCredit = futuresBd('Cur', -5, base);
    const peer = futuresBd('Peer', 0, base);
    const { usd } = calculateSavings(currentCredit, peer, true, 'BTC', 'USDT');
    expect(usd).toBeCloseTo(5, 6);
  });
});
