import { useEffect, useMemo, useState, useCallback } from 'react';
import { EXCHANGE_REGISTRY, type ExchangeId } from '../../exchanges';
import { ACCOUNT_SETTINGS_STORAGE_KEY } from '../../utils/constants';
import { readJSONFromLocalStorage, writeJSONToLocalStorage } from '../../utils/local-storage';
import type { FeeMeta, PerExchangeSettings } from '../types';

/**
 * React hook for managing exchange-specific fee metadata and user settings.
 *
 * This hook loads fee data for all registered exchanges, merges it with any cached user settings,
 * and provides methods to update and persist these settings. It also exposes metadata such as
 * available user tiers, default tiers, and token discount support for each exchange.
 *
 * @returns An object containing:
 * - `feeMeta`: Metadata for each exchange, including user tiers, default tier, and token discount support.
 * - `settings`: User-selected settings for each exchange, such as selected tier and token discount preference.
 * - `defaultTierByEx`: Mapping of exchange IDs to their default user tier.
 * - `setSettings`: Function to update settings for a specific exchange.
 *
 * @remarks
 * - Settings are automatically persisted when changed.
 * - Fee metadata is loaded asynchronously on mount.
 */
export function useExchangeSettings() {
  const [feeMeta, setFeeMeta] = useState<Partial<Record<ExchangeId, FeeMeta>>>({});
  const [settings, setSettings] = useState<Partial<Record<ExchangeId, PerExchangeSettings>>>({});

  useEffect(() => {
    let alive = true;

    (async () => {
      const ids = Object.keys(EXCHANGE_REGISTRY) as ExchangeId[];
      const cached =
        (readJSONFromLocalStorage(ACCOUNT_SETTINGS_STORAGE_KEY) as Partial<
          Record<ExchangeId, PerExchangeSettings>
        >) ?? {};

      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const data = EXCHANGE_REGISTRY[id].getFeeData?.();

            const userTiersRaw = Array.isArray(data?.userTiers) ? data!.userTiers : [];
            const userTiers = userTiersRaw.length > 0 ? userTiersRaw : [];
            const defaultTier = (data?.schedule?.defaultTier as string) || userTiers[0] || '';
            const supportsTokenDiscount = !!data?.supportsTokenDiscount;

            return [id, { userTiers, defaultTier, supportsTokenDiscount } as FeeMeta] as const;
          } catch {
            return [
              id,
              { userTiers: [], defaultTier: '', supportsTokenDiscount: false } as FeeMeta,
            ] as const;
          }
        })
      );

      if (!alive) return;

      const metaObj = Object.fromEntries(entries) as Record<ExchangeId, FeeMeta>;
      setFeeMeta(metaObj);

      setSettings((prev) => {
        const next: Partial<Record<ExchangeId, PerExchangeSettings>> = { ...prev };

        (Object.keys(metaObj) as ExchangeId[]).forEach((id) => {
          const cachedForEx = cached[id];
          if (cachedForEx) {
            const tiers = metaObj[id]?.userTiers ?? [];
            const defaultTier = metaObj[id]?.defaultTier ?? '';
            const userTier = tiers.includes(cachedForEx.userTier ?? '')
              ? (cachedForEx.userTier as string)
              : defaultTier;

            next[id] = {
              userTier,
              tokenDiscount: !!cachedForEx.tokenDiscount,
            };
          }
        });

        (Object.keys(metaObj) as ExchangeId[]).forEach((id) => {
          if (!next[id]) {
            next[id] = {
              userTier: metaObj[id]?.defaultTier ?? '',
              tokenDiscount: false,
            };
          }
        });

        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!Object.keys(settings).length) return;
    writeJSONToLocalStorage(ACCOUNT_SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  const updateSettings = useCallback(
    (id: ExchangeId, patch: Partial<PerExchangeSettings>) => {
      setSettings((prev) => {
        const current = prev[id] ?? {
          userTier: (feeMeta[id]?.defaultTier ?? '') as string,
          tokenDiscount: false,
        };

        return { ...prev, [id]: { ...current, ...patch } };
      });
    },
    [feeMeta]
  );

  const defaultTierByEx = useMemo(() => {
    const map: Partial<Record<ExchangeId, string>> = {};
    (Object.keys(feeMeta) as ExchangeId[]).forEach(
      (id) => (map[id] = feeMeta[id]?.defaultTier ?? '')
    );

    return map;
  }, [feeMeta]);

  return { feeMeta, settings, defaultTierByEx, setSettings: updateSettings };
}
