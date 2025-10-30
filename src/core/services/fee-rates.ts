import type { FeeData, Modifier, FeeRateResult, FeeRateAnalysis } from '../interfaces/fee-config';
import { parsePair } from '../../utils/utils';

/**
 * Applies the given effect to the current rates.
 *
 * @param effect The effect to apply
 * @param tier The user tier
 * @param cur The current rates
 * @returns The new rates after applying the effect
 */
function applyModifier(
  effect: Modifier['effect'],
  tier: string,
  cur: { maker: number; taker: number }
) {
  if (effect.mode === 'override')
    return { maker: effect.maker ?? cur.maker, taker: effect.taker ?? cur.taker };

  if (effect.mode === 'multiply')
    return {
      maker: effect.maker != null ? cur.maker * effect.maker : cur.maker,
      taker: effect.taker != null ? cur.taker * effect.taker : cur.taker,
    };

  if (effect.mode === 'add')
    return {
      maker: effect.maker != null ? cur.maker + effect.maker : cur.maker,
      taker: effect.taker != null ? cur.taker + effect.taker : cur.taker,
    };

  if (effect.mode === 'override_per_tier') {
    const row = effect.perTier?.[tier];
    return { maker: row?.maker ?? cur.maker, taker: row?.taker ?? cur.taker };
  }

  return cur;
}

/**
 * Applies a discount to a given rate.
 *
 * @param rate The original rate
 * @param discount The discount descriptor
 * @returns The discounted rate
 */
function applyDiscount(rate: number, discount: { type: string; value: number }) {
  switch (discount.type) {
    case 'percentage':
      return rate * (1 - discount.value);
    case 'bps':
      return rate * (1 - discount.value / 10000);
    case 'absolute':
      return rate - discount.value;
    default:
      return rate;
  }
}

/**
 * Checks if a modifier applies to a given trading context.
 *
 * @param modifier The modifier to check
 * @param pair The trading pair
 * @param tier The user tier
 * @param exec The execution type
 * @returns True if the modifier applies, false otherwise
 */
function matches(modifier: Modifier, pair: string, tier: string, exec: string): boolean {
  const { base, quote } = parsePair(pair);

  const mm = modifier.match ?? {};
  const okQ = !mm.quoteAssets || mm.quoteAssets.includes(quote);
  const okB = !mm.baseAssets || mm.baseAssets.includes(base);
  const okP = !mm.pairs || mm.pairs.includes(`${base}/${quote}`);
  const okR = !mm.pairsRegex || new RegExp(mm.pairsRegex, 'i').test(`${base}/${quote}`);
  const okE = !mm.exec || mm.exec.includes(exec);
  const okT = !mm.tiers || mm.tiers.includes(tier);

  return okQ && okB && okP && okR && okE && okT;
}

/**
 * Calculates the fee rates for a given context.
 *
 * @param fees The fee data
 * @param ctx The context for the fee calculation
 * @returns The calculated fee rates
 */
export function calculateFeeRates(
  fees: FeeData,
  ctx: {
    pair: string;
    exec: string;
    userTier?: string;
    feeAsset?: string;
    customFees?: number;
  }
): FeeRateResult {
  const schedule = fees.schedule;
  const feeRateAnalysis: FeeRateAnalysis[] = [];
  const tier = ctx.userTier && schedule.tiers[ctx.userTier] ? ctx.userTier : schedule.defaultTier;
  let allowFurtherModifiers = true;
  let allowFurtherDiscounts = true;
  let cur: { maker: number; taker: number };

  feeRateAnalysis.push({
    id: `Apply ${tier} fee`,
    type: 'default',
    rate: schedule.tiers[tier].taker,
  });

  if (ctx.customFees === undefined) {
    const mods = [...(fees.modifiers ?? [])];
    cur = { ...schedule.tiers[tier] };

    for (const mod of mods) {
      if (!allowFurtherModifiers) break;
      if (!matches(mod, ctx.pair, tier, ctx.exec)) continue;

      cur = applyModifier(mod.effect, tier, cur);
      const modifierId =
        mod.effect.mode === 'override' || mod.effect.mode === 'override_per_tier'
          ? `Override with ${mod.id}`
          : `Apply ${mod.id}`;
      feeRateAnalysis.push({
        id: modifierId,
        type: mod.effect.mode,
        rate: cur.taker,
      });

      if (mod.stacking?.exclusive) break;
      if (mod.stacking?.withOtherModifiers === false) allowFurtherModifiers = false;
      if (mod.stacking?.withDiscounts === false) allowFurtherDiscounts = false;
    }

    if (
      fees.tokenDiscount &&
      fees.tokenDiscount.order === 'after_modifiers' &&
      fees.tokenDiscount.requires?.feeAsset &&
      fees.tokenDiscount.requires?.feeAsset.toUpperCase() === (ctx.feeAsset ?? '').toUpperCase() &&
      allowFurtherDiscounts
    ) {
      if (fees.tokenDiscount.appliesTo.includes('maker'))
        cur.maker = applyDiscount(cur.maker, fees.tokenDiscount);
      if (fees.tokenDiscount.appliesTo.includes('taker'))
        cur.taker = applyDiscount(cur.taker, fees.tokenDiscount);

      feeRateAnalysis.push({
        id: `Apply ${fees.tokenDiscount.id}`,
        type: 'token_discount',
        rate: cur.taker,
      });
    }
  } else {
    cur = { maker: ctx.customFees, taker: ctx.customFees };
    feeRateAnalysis.push({
      id: 'Override with custom fee',
      type: 'custom',
      rate: cur.taker,
    });
  }

  return {
    base: { ...schedule.tiers[tier], tier, schedule: schedule.name },
    final: cur,
    feeRateAnalysis,
  };
}
