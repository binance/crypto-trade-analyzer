import { useMemo } from 'react';
import { EXCHANGE_REGISTRY, type ExchangeId } from '../../exchanges';

/**
 * Custom React hook that provides exchange catalog data.
 *
 * - `ids`: An array of all exchange IDs from the registry.
 * - `names`: A mapping from exchange IDs to their display names.
 * - `cardOrder`: An array of exchange IDs sorted by their display names.
 *
 * Uses memoization to optimize performance and prevent unnecessary recalculations.
 *
 * @returns An object containing `ids`, `names`, and `cardOrder` for use in components.
 */
export function useExchangeCatalog() {
  const ids = useMemo(() => Object.keys(EXCHANGE_REGISTRY) as ExchangeId[], []);
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
