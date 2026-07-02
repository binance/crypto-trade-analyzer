import { describe, it, expect } from 'vitest';
import { computeFundingCostUsd } from '../funding-rate';
import type { FundingInfo } from '../funding-rate';

const info8h: FundingInfo = { ratePerInterval: 0.0001, intervalHours: 8 };
const infoNeg: FundingInfo = { ratePerInterval: -0.0001, intervalHours: 8 };
const info1h: FundingInfo = { ratePerInterval: 0.0001, intervalHours: 1 };

describe('computeFundingCostUsd — sign conventions', () => {
  it('long (buy) with positive rate: positive cost (longs pay)', () => {
    const cost = computeFundingCostUsd(info8h, 10_000, 'buy', 8);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(1, 4);
  });

  it('short (sell) with positive rate: negative cost (shorts receive)', () => {
    const cost = computeFundingCostUsd(info8h, 10_000, 'sell', 8);
    expect(cost).toBeLessThan(0);
    expect(cost).toBeCloseTo(-1, 4);
  });

  it('long (buy) with negative rate: negative cost (credit to longs)', () => {
    const cost = computeFundingCostUsd(infoNeg, 10_000, 'buy', 8);
    expect(cost).toBeLessThan(0);
    expect(cost).toBeCloseTo(-1, 4);
  });

  it('short (sell) with negative rate: positive cost (shorts pay)', () => {
    const cost = computeFundingCostUsd(infoNeg, 10_000, 'sell', 8);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(1, 4);
  });

  it('long and short costs are exact opposites for same inputs', () => {
    const buy = computeFundingCostUsd(info8h, 10_000, 'buy', 8);
    const sell = computeFundingCostUsd(info8h, 10_000, 'sell', 8);
    expect(buy).toBeCloseTo(-sell, 10);
  });
});

describe('computeFundingCostUsd — proportional interval model', () => {
  it('one full interval: rate × notional × 1', () => {
    expect(computeFundingCostUsd(info8h, 10_000, 'buy', 8)).toBeCloseTo(1, 8);
  });

  it('partial holding period is prorated, not rounded up', () => {
    expect(computeFundingCostUsd(info8h, 10_000, 'buy', 4)).toBeCloseTo(0.5, 8);
  });

  it('48min on 8h interval = 0.1 intervals (not ceil=1)', () => {
    expect(computeFundingCostUsd(info8h, 10_000, 'buy', 0.8)).toBeCloseTo(0.1, 8);
  });

  it('1h interval crosses 8 settlements in 8h vs 1 for 8h interval', () => {
    const cost1h = computeFundingCostUsd(info1h, 10_000, 'buy', 8);
    const cost8h = computeFundingCostUsd(info8h, 10_000, 'buy', 8);
    expect(cost1h).toBeCloseTo(cost8h * 8, 8);
  });

  it('scales linearly with holding period', () => {
    const cost1 = computeFundingCostUsd(info8h, 10_000, 'buy', 8);
    const cost2 = computeFundingCostUsd(info8h, 10_000, 'buy', 16);
    expect(cost2).toBeCloseTo(cost1 * 2, 8);
  });

  it('scales linearly with notional', () => {
    const c1 = computeFundingCostUsd(info8h, 1_000, 'buy', 8);
    const c2 = computeFundingCostUsd(info8h, 10_000, 'buy', 8);
    expect(c2).toBeCloseTo(c1 * 10, 8);
  });
});

describe('computeFundingCostUsd — edge cases', () => {
  it('returns 0 when notional is 0', () => {
    expect(computeFundingCostUsd(info8h, 0, 'buy', 8)).toBe(0);
  });

  it('returns 0 when holdingHours is 0', () => {
    expect(computeFundingCostUsd(info8h, 10_000, 'buy', 0)).toBe(0);
  });

  it('returns 0 when holdingHours is negative', () => {
    expect(computeFundingCostUsd(info8h, 10_000, 'buy', -1)).toBe(0);
  });

  it('returns 0 when intervalHours is 0 (guard against divide-by-zero)', () => {
    expect(
      computeFundingCostUsd({ ratePerInterval: 0.0001, intervalHours: 0 }, 10_000, 'buy', 8)
    ).toBe(0);
  });

  it('returns 0 when notional is negative', () => {
    expect(computeFundingCostUsd(info8h, -100, 'buy', 8)).toBe(0);
  });

  it('returns 0 for zero rate', () => {
    expect(computeFundingCostUsd({ ratePerInterval: 0, intervalHours: 8 }, 10_000, 'buy', 8)).toBe(
      0
    );
  });
});
