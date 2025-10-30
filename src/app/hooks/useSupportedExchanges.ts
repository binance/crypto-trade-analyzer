import { useEffect, useState } from 'react';
import { parsePair } from '../../utils/utils';
import type { ExchangeId } from '../../exchanges';
import type { PairDirectory } from '../../core/services/pair-directory';

/**
 * React hook to determine which exchanges support trading for a given trading pair.
 *
 * @param params - The parameters for the hook.
 * @param params.tradingPair - The trading pair (e.g., "BTC/USD").
 * @param params.pairDir - The directory object providing exchange information for pairs.
 * @param params.allowed - The list of exchange IDs that are allowed.
 * @returns A `Set` of exchange IDs that support the specified trading pair and are allowed.
 *
 * @remarks
 * - Returns an empty set if `tradingPair` or `pairDir` is not provided.
 * - Filters the exchanges for the trading pair to only those in the allowed list.
 * - Handles asynchronous fetching and cancellation to avoid state updates on unmounted components.
 */
export function useSupportedExchanges(params: {
  tradingPair: string;
  pairDir: PairDirectory | null;
  allowed: ExchangeId[];
}) {
  const { tradingPair, pairDir, allowed } = params;
  const [supportedSet, setSupportedSet] = useState(new Set<ExchangeId>());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tradingPair || !pairDir) {
        if (!cancelled) setSupportedSet(new Set<ExchangeId>());
        return;
      }

      const { base, quote } = parsePair(tradingPair);

      try {
        const exchanges = await pairDir.exchangesForPair(base, quote);
        const allowedSet = new Set<ExchangeId>(allowed);
        const filtered = exchanges.filter((id): id is ExchangeId =>
          allowedSet.has(id as ExchangeId)
        );
        if (!cancelled) setSupportedSet(new Set(filtered));
      } catch (e) {
        console.warn('exchangesForPair failed', e);
        if (!cancelled) setSupportedSet(new Set<ExchangeId>());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tradingPair, pairDir, allowed]);

  return supportedSet;
}
