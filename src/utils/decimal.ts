import Decimal from 'decimal.js';

/**
 * Decimal.js configuration
 */
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -7,
  toExpPos: 21,
});

export { Decimal };
