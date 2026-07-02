import { describe, it, expect } from 'vitest';
import { calculateFeeRates } from '../fee-rates';
import type { FeeData } from '../../interfaces/fee-config';

function baseFees(overrides: Partial<FeeData> = {}): FeeData {
  return {
    exchange: 'Test',
    version: 'test',
    userTiers: ['Tier0', 'Tier1'],
    supportsTokenDiscount: false,
    schedule: {
      name: 'test-schedule',
      defaultTier: 'Tier0',
      tiers: {
        Tier0: { maker: 0.002, taker: 0.004 },
        Tier1: { maker: 0.001, taker: 0.002 },
      },
    },
    ...overrides,
  };
}

describe('calculateFeeRates — tier selection', () => {
  it('uses default tier when userTier is omitted', () => {
    const r = calculateFeeRates(baseFees(), { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.base.tier).toBe('Tier0');
    expect(r.final.taker).toBe(0.004);
  });

  it('uses requested tier when valid', () => {
    const r = calculateFeeRates(baseFees(), { pair: 'BTC/USDT', exec: 'taker', userTier: 'Tier1' });
    expect(r.base.tier).toBe('Tier1');
    expect(r.final.taker).toBe(0.002);
  });

  it('falls back to default tier when requested tier is unknown', () => {
    const r = calculateFeeRates(baseFees(), {
      pair: 'BTC/USDT',
      exec: 'taker',
      userTier: 'Nonexistent',
    });
    expect(r.base.tier).toBe('Tier0');
  });

  it('reports schedule name', () => {
    const r = calculateFeeRates(baseFees(), { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.base.schedule).toBe('test-schedule');
  });
});

describe('calculateFeeRates — customFees', () => {
  it('overrides both maker and taker, ignoring modifiers', () => {
    const fees = baseFees({
      modifiers: [{ id: 'm', match: {}, effect: { mode: 'override', maker: 0, taker: 0 } }],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', customFees: 0.0005 });
    expect(r.final.maker).toBe(0.0005);
    expect(r.final.taker).toBe(0.0005);
    expect(r.feeRateAnalysis.some((a) => a.type === 'custom')).toBe(true);
  });

  it('customFees of 0 is respected (not treated as missing)', () => {
    const r = calculateFeeRates(baseFees(), { pair: 'BTC/USDT', exec: 'taker', customFees: 0 });
    expect(r.final.taker).toBe(0);
  });
});

describe('calculateFeeRates — modifier modes', () => {
  it('override replaces maker/taker', () => {
    const fees = baseFees({
      modifiers: [
        { id: 'ovr', match: {}, effect: { mode: 'override', maker: 0.0001, taker: 0.0003 } },
      ],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.final).toEqual({ maker: 0.0001, taker: 0.0003 });
  });

  it('multiply scales the current rates', () => {
    const fees = baseFees({
      modifiers: [{ id: 'mul', match: {}, effect: { mode: 'multiply', maker: 0.5, taker: 0.5 } }],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.final.taker).toBeCloseTo(0.002, 10);
  });

  it('add adjusts the current rates', () => {
    const fees = baseFees({
      modifiers: [{ id: 'add', match: {}, effect: { mode: 'add', maker: 0.001, taker: 0.001 } }],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.final.taker).toBeCloseTo(0.005, 10);
  });

  it('override_per_tier uses the matching tier row', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'per-tier',
          match: {},
          effect: { mode: 'override_per_tier', perTier: { Tier0: { maker: 0, taker: 0.00005 } } },
        },
      ],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.final.taker).toBe(0.00005);
  });

  it('override_per_tier falls back to current when tier absent in perTier', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'per-tier',
          match: {},
          effect: { mode: 'override_per_tier', perTier: { Tier1: { maker: 0, taker: 0.00005 } } },
        },
      ],
    });
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' });
    expect(r.final.taker).toBe(0.004);
  });
});

describe('calculateFeeRates — modifier matching', () => {
  it('matches by quoteAssets', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'usdc',
          match: { quoteAssets: ['USDC'] },
          effect: { mode: 'override', maker: 0, taker: 0.0001 },
        },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDC', exec: 'taker' }).final.taker).toBe(0.0001);
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBe(0.004);
  });

  it('matches by baseAssets', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'btc',
          match: { baseAssets: ['BTC'] },
          effect: { mode: 'override', maker: 0, taker: 0.0002 },
        },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBe(0.0002);
    expect(calculateFeeRates(fees, { pair: 'ETH/USDT', exec: 'taker' }).final.taker).toBe(0.004);
  });

  it('matches by pairsRegex', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'stable',
          match: { pairsRegex: '^(USDC|USDT)/(USDC|USDT)$' },
          effect: { mode: 'override', maker: 0, taker: 0.00001 },
        },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'USDC/USDT', exec: 'taker' }).final.taker).toBe(0.00001);
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBe(0.004);
  });

  it('matches by tier restriction', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 't1only',
          match: { tiers: ['Tier1'] },
          effect: { mode: 'override', maker: 0, taker: 0.0009 },
        },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBe(0.004);
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', userTier: 'Tier1' }).final.taker
    ).toBe(0.0009);
  });
});

describe('calculateFeeRates — stacking', () => {
  it('applies multiple modifiers in sequence by default', () => {
    const fees = baseFees({
      modifiers: [
        { id: 'a', match: {}, effect: { mode: 'add', maker: 0.001, taker: 0.001 } },
        { id: 'b', match: {}, effect: { mode: 'multiply', maker: 0.5, taker: 0.5 } },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBeCloseTo(
      0.0025,
      10
    );
  });

  it('exclusive modifier stops further modifiers', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'a',
          match: {},
          effect: { mode: 'override', maker: 0, taker: 0.001 },
          stacking: { exclusive: true },
        },
        { id: 'b', match: {}, effect: { mode: 'multiply', maker: 0.5, taker: 0.5 } },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBe(0.001);
  });

  it('withOtherModifiers:false blocks subsequent modifiers', () => {
    const fees = baseFees({
      modifiers: [
        {
          id: 'a',
          match: {},
          effect: { mode: 'add', maker: 0, taker: 0.001 },
          stacking: { withOtherModifiers: false },
        },
        { id: 'b', match: {}, effect: { mode: 'add', maker: 0, taker: 0.001 } },
      ],
    });
    expect(calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker' }).final.taker).toBeCloseTo(
      0.005,
      10
    );
  });
});

describe('calculateFeeRates — token discount', () => {
  const withDiscount = (type: string, value: number): FeeData =>
    baseFees({
      supportsTokenDiscount: true,
      tokenDiscount: {
        id: 'BNB 10%',
        label: 'Pay in BNB',
        type,
        value,
        requires: { feeAsset: 'BNB' },
        appliesTo: ['maker', 'taker'],
        order: 'after_modifiers',
      },
    });

  it('applies percentage discount only when feeAsset matches', () => {
    const fees = withDiscount('percentage', 0.1);
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'BNB' }).final.taker
    ).toBeCloseTo(0.0036, 10);
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'USDT' }).final.taker
    ).toBe(0.004);
  });

  it('applies bps discount', () => {
    const fees = withDiscount('bps', 100);
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'BNB' }).final.taker
    ).toBeCloseTo(0.004 * 0.99, 10);
  });

  it('applies absolute discount', () => {
    const fees = withDiscount('absolute', 0.001);
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'BNB' }).final.taker
    ).toBeCloseTo(0.003, 10);
  });

  it('records token_discount in analysis', () => {
    const fees = withDiscount('percentage', 0.1);
    const r = calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'BNB' });
    expect(r.feeRateAnalysis.some((a) => a.type === 'token_discount')).toBe(true);
  });

  it('modifier with withDiscounts:false blocks the token discount', () => {
    const fees = baseFees({
      supportsTokenDiscount: true,
      modifiers: [
        {
          id: 'm',
          match: {},
          effect: { mode: 'override', maker: 0, taker: 0.002 },
          stacking: { withDiscounts: false },
        },
      ],
      tokenDiscount: {
        id: 'BNB 10%',
        label: 'Pay in BNB',
        type: 'percentage',
        value: 0.1,
        requires: { feeAsset: 'BNB' },
        appliesTo: ['maker', 'taker'],
        order: 'after_modifiers',
      },
    });
    expect(
      calculateFeeRates(fees, { pair: 'BTC/USDT', exec: 'taker', feeAsset: 'BNB' }).final.taker
    ).toBe(0.002);
  });
});
