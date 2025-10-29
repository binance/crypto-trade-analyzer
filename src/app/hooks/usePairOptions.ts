import { useEffect, useMemo, useState } from 'react';
import { PairDirectory } from '../../core/services/pair-directory';
import type { ExchangeId } from '../../exchanges';
import type { PairMeta } from '../types';

type PairItem = {
  base: string;
  quote: string;
  exchanges?: ExchangeId[];
  byEx?: ExchangeId[];
};

/**
 * Custom React hook to fetch and manage available trading pair options and their metadata.
 *
 * This hook initializes a `PairDirectory` instance and asynchronously loads trading pairs,
 * including their supported exchanges. It provides a list of trading pair labels, metadata for each pair,
 * a loading state, and the directory instance.
 *
 * @returns An object containing:
 * - `pairOptions`: Array of string labels for available trading pairs (e.g., "BTC/USD").
 * - `pairMeta`: Record mapping trading pair labels to metadata, including supported exchanges.
 * - `loadingPairs`: Boolean indicating if the trading pairs are currently being loaded.
 * - `pairDir`: The `PairDirectory` instance used to fetch trading pair data.
 *
 * @remarks
 * - Handles both `exchanges` and `byEx` fields defensively for compatibility.
 * - Cleans up asynchronous effects to prevent state updates after unmount.
 */
export function usePairOptions() {
  const pairDir = useMemo(() => new PairDirectory(), []);
  const [pairOptions, setPairOptions] = useState<string[]>([]);
  const [pairMeta, setPairMeta] = useState<Record<string, PairMeta>>({});
  const [loadingPairs, setLoadingPairs] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoadingPairs(true);

      try {
        const list = await pairDir.getPairsWithExchanges();

        const opts: string[] = [];
        const meta: Record<string, PairMeta> = {};

        for (const pair of list as PairItem[]) {
          const label = `${pair.base}/${pair.quote}`;
          const exchanges: ExchangeId[] = Array.isArray(pair.exchanges)
            ? pair.exchanges!
            : Array.isArray(pair.byEx)
              ? pair.byEx!
              : [];

          opts.push(label);
          meta[label] = {
            supportedBy: exchanges.length,
            exchanges: exchanges,
          };
        }

        if (alive) {
          setPairOptions(opts);
          setPairMeta(meta);
        }
      } catch (e) {
        console.error('Failed to load trading pairs', e);
      } finally {
        if (alive) setLoadingPairs(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pairDir]);

  return { pairOptions, pairMeta, loadingPairs, pairDir };
}
