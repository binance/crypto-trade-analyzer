import { useMemo } from 'react';
import { getRegistry, type ExchangeId } from '../../exchanges';
import type { MarketType } from '../../core/interfaces/order-book';

/**
 * Custom React hook that provides exchange catalog data for the active market.
 *
 * - `ids`: An array of exchange IDs available in the given market (futures omits Coinbase).
 * - `names`: A mapping from exchange IDs to their display names.
 * - `cardOrder`: An array of exchange IDs sorted by their display names.
 *
 * Uses memoization to optimize performance and prevent unnecessary recalculations.
 *
 * @param marketType - The active market ('spot' | 'futures'). Defaults to 'spot'.
 * @returns An object containing `ids`, `names`, and `cardOrder` for use in components.
 */
export function useExchangeCatalog(marketType: MarketType = 'spot') {
  const ids = useMemo(() => Object.keys(getRegistry(marketType)) as ExchangeId[], [marketType]);
  const names = useMemo(
    () => Object.fromEntries(ids.map((id) => [id, id])) as Record<ExchangeId, string>,
    [ids]
  );

  const cardOrder = useMemo(
    () => [...ids].sort((a, b) => names[a].localeCompare(names[b])),
    [ids, names]
  );

  return { ids, names, cardOrder };
}
