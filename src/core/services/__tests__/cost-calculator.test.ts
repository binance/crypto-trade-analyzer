import { describe, it, expect } from 'vitest';
import { Decimal } from '../../../utils/decimal';
import { CostCalculator } from '../cost-calculator';
import type { USDConverter } from '../usd-converter';
import type { OrderBook } from '../../interfaces/order-book';
import type { FeeRateResult } from '../../interfaces/fee-config';

const usdStub = {
  convert: async (asset: string) => {
    const a = asset.toUpperCase();
    if (a === 'BNB') return new Decimal(600);
    return new Decimal(1);
  },
} as unknown as USDConverter;

const calc = new CostCalculator(usdStub);

const book: OrderBook = {
  asks: [
    { price: 100, quantity: 1 },
    { price: 101, quantity: 1 },
    { price: 102, quantity: 1 },
  ],
  bids: [
    { price: 99, quantity: 1 },
    { price: 98, quantity: 1 },
    { price: 97, quantity: 1 },
  ],
};

function feeRates(taker: number): FeeRateResult {
  return {
    base: { maker: taker, taker, tier: 'T', schedule: 's' },
    final: { maker: taker, taker },
    feeRateAnalysis: [],
  };
}

describe('CostCalculator — guards', () => {
  it('throws on non-positive size', async () => {
    await expect(
      calc.calculateCost('X', book, 0, 'buy', feeRates(0), 'BTC', 'USDT')
    ).rejects.toThrow('Size must be positive');
  });

  it('throws on empty order book', async () => {
    const empty: OrderBook = { asks: [], bids: [] };
    await expect(
      calc.calculateCost('X', empty, 1, 'buy', feeRates(0), 'BTC', 'USDT')
    ).rejects.toThrow('Empty order book');
  });

  it('throws on insufficient liquidity (base sizing)', async () => {
    await expect(
      calc.calculateCost('X', book, 10, 'buy', feeRates(0), 'BTC', 'USDT', { sizeAsset: 'base' })
    ).rejects.toThrow(/Insufficient liquidity/);
  });
});

describe('CostCalculator — buy / base sizing', () => {
  it('walks the ask book and computes avg price + execution', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'BTC',
    });
    expect(r.sizeBase).toBe(2);
    expect(r.averagePrice).toBeCloseTo(100.5, 8);
    expect(r.execution.amount).toBeCloseTo(201, 8);
    expect(r.execution.usd).toBeCloseTo(201, 8);
  });

  it('computes slippage vs best ask reference', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'BTC',
    });
    expect(r.slippage.rate).toBeCloseTo(0.005, 8);
  });

  it('fee in base reduces net base received', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0.001), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'BTC',
    });
    expect(r.tradingFee.asset).toBe('BTC');
    expect(r.tradingFee.amount).toBeCloseTo(0.002, 8);
    expect(r.netBaseReceived).toBeCloseTo(1.998, 8);
  });

  it('totalTradeUsd = execution USD + fee USD', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0.001), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'BTC',
    });
    expect(r.totalTradeUsd).toBeCloseTo(201 + 0.201, 6);
  });
});

describe('CostCalculator — buy / quote sizing', () => {
  it('fulfills a quote target and derives base amount', async () => {
    const r = await calc.calculateCost('X', book, 201, 'buy', feeRates(0), 'BTC', 'USDT', {
      sizeAsset: 'quote',
      feeAsset: 'BTC',
    });
    expect(r.sizeBase).toBeCloseTo(2, 8);
    expect(r.execution.amount).toBeCloseTo(201, 8);
  });
});

describe('CostCalculator — sell / base sizing', () => {
  it('walks the bid book', async () => {
    const r = await calc.calculateCost('X', book, 2, 'sell', feeRates(0), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'USDT',
    });
    expect(r.averagePrice).toBeCloseTo(98.5, 8);
    expect(r.execution.amount).toBeCloseTo(197, 8);
  });

  it('fee in quote reduces net quote received', async () => {
    const r = await calc.calculateCost('X', book, 2, 'sell', feeRates(0.001), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'USDT',
    });
    expect(r.tradingFee.asset).toBe('USDT');
    expect(r.tradingFee.amount).toBeCloseTo(0.197, 8);
    expect(r.netQuoteReceived).toBeCloseTo(196.803, 6);
  });
});

describe('CostCalculator — fee in third asset', () => {
  it('converts fee to the third asset via USD', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0.001), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeScenario: { feeAsset: 'BNB', feeRates: feeRates(0.001) },
    });
    expect(r.tradingFee.asset).toBe('BNB');
    expect(r.tradingFee.usd).toBeCloseTo(0.201, 6);
    expect(r.tradingFee.amount).toBeCloseTo(0.201 / 600, 10);
    expect(r.netBaseReceived).toBeCloseTo(2, 8);
  });
});

describe('CostCalculator — reference basis', () => {
  it('mid basis uses midpoint of best bid/ask', async () => {
    const r = await calc.calculateCost('X', book, 2, 'buy', feeRates(0), 'BTC', 'USDT', {
      sizeAsset: 'base',
      feeAsset: 'BTC',
      referenceBasis: 'mid',
    });
    expect(r.referencePrice).toBeCloseTo(99.5, 8);
    expect(r.slippage.rate).toBeCloseTo((100.5 - 99.5) / 99.5, 8);
  });
});
