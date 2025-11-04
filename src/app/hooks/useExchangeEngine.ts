import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXCHANGE_REGISTRY, type ExchangeId } from '../../exchanges';
import type { OrderBook, OrderSide, OrderSizeAsset } from '../../core/interfaces/order-book';
import type { PerExchangeSettings } from '../types';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import {
  calculateRankedExchanges,
  calculateSavings,
  mapOrderBook,
  parsePair,
  sleep,
} from '../../utils/utils';
import {
  evtTradingPairSelected,
  evtExchangesSelected,
  evtOrderbookPushLatencyMs,
  evtCalcLatencyMs,
  evtExchangeStatus,
  evtCalcPerformed,
  evtExchangeSessionStart,
  evtExchangeSessionEnd,
  evtExchangeSessionSummary,
} from '../../utils/analytics';

/**
 * React hook for managing live order book data, cost calculations, and exchange selection logic
 * for multiple crypto exchanges in a fee comparator application.
 *
 * This hook handles:
 * - Subscribing/unsubscribing to live order book data per exchange and trading pair.
 * - Debouncing and sequencing async operations to avoid race conditions.
 * - Calculating trading costs per exchange, including user tier and token discount settings.
 * - Managing UI state for errors, cost breakdowns, and best exchange selection.
 * - Auto-selecting supported exchanges when a trading pair is chosen.
 * - Cleaning up subscriptions and timers on unmount or deselection.
 *
 * @param params - Configuration and state for the hook.
 * @param params.tradingPair - Trading pair (e.g., "BTC/USD").
 * @param params.size - Order size for cost calculation.
 * @param params.sizeAsset - The asset type for the order size ('base' or 'quote').
 * @param params.side - Order side ("buy" or "sell").
 * @param params.selected - Array of selected exchange IDs.
 * @param params.supportedSet - Set of exchange IDs that support the current trading pair.
 * @param params.settings - Per-exchange user settings (tier, discount, etc.).
 * @param params.defaultTierByEx - Optional default user tier per exchange.
 * @param params.paused - Optional flag to pause live updates.
 * @param params.onSelectExchanges - Optional callback for auto-selecting exchanges.
 *
 * @returns An object containing:
 * - books: Live order book data per exchange.
 * - costBreakdownMap: Cost breakdowns per exchange.
 * - errors: Error messages per exchange.
 * - rankedExchanges: Array of exchange IDs ranked by total cost (lowest to highest).
 * - calcTimestamps: Timestamps of last cost calculation per exchange.
 * - priceBucket: The tick size (price bucket) used for the current trading pair.
 */
export function useExchangeEngine(params: {
  tradingPair: string;
  size: number;
  sizeAsset: OrderSizeAsset;
  side: OrderSide;
  selected: ExchangeId[];
  supportedSet: Set<ExchangeId>;
  settings: Partial<Record<ExchangeId, PerExchangeSettings>>;
  defaultTierByEx?: Partial<Record<ExchangeId, string>>;
  paused?: boolean;
  onSelectExchanges?: (next: ExchangeId[]) => void;
}) {
  const {
    tradingPair,
    size,
    sizeAsset,
    side,
    selected,
    supportedSet,
    settings,
    defaultTierByEx,
    paused = false,
    onSelectExchanges,
  } = params;

  const allExchangeIds = useMemo(() => Object.keys(EXCHANGE_REGISTRY) as ExchangeId[], []);

  const makeMap = useCallback(
    <T>(init: T) =>
      allExchangeIds.reduce(
        (acc, id) => {
          acc[id] = init;
          return acc;
        },
        {} as Record<ExchangeId, T>
      ),
    [allExchangeIds]
  );

  const [books, setBooks] = useState<
    Record<ExchangeId, (OrderBook & { tradingPair: string }) | undefined>
  >(() => makeMap<(OrderBook & { tradingPair: string }) | undefined>(undefined));
  const [costBreakdownMap, setCostBreakdownMap] = useState<
    Record<ExchangeId, CostBreakdown | undefined>
  >(() => makeMap<CostBreakdown | undefined>(undefined));
  const [errors, setErrors] = useState<Record<ExchangeId, string | null>>(() =>
    makeMap<string | null>(null)
  );
  const [calcTimestamps, setCalcTimestamps] = useState<Record<ExchangeId, Date | undefined>>(() =>
    makeMap<Date | undefined>(undefined)
  );
  const [priceBucket, setPriceBucket] = useState<number | undefined>(undefined);

  const pairKeyByEx = useRef<Record<ExchangeId, string | null>>(makeMap<string | null>(null));
  const lastBucketByEx = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const liveReadyRef = useRef<Record<ExchangeId, boolean>>(makeMap<boolean>(false));
  const opSeqRef = useRef<Record<ExchangeId, number>>(makeMap<number>(0));
  const watchMutexRef = useRef<Record<ExchangeId, Promise<void>>>(makeMap(Promise.resolve()));
  const isDisconnectingRef = useRef<Record<ExchangeId, boolean>>(makeMap<boolean>(false));
  const subsRef = useRef<Record<ExchangeId, (() => void) | null>>(
    makeMap<(() => void) | null>(null)
  );
  const recomputeTimers = useRef<Record<ExchangeId, number | null>>(makeMap<number | null>(null));
  const tickCacheRef = useRef<Record<string, number | undefined>>({});
  const tradingPairRef = useRef(tradingPair);
  const prevTradingPairRef = useRef<string | undefined>(undefined);
  const sizeRef = useRef(size);
  const sizeAssetRef = useRef<'base' | 'quote'>(sizeAsset);
  const sideRef = useRef(side);
  const selectedRef = useRef<ExchangeId[]>(selected);
  const lastSelectedRef = useRef<ExchangeId[]>(selected);
  const settingsRef = useRef(settings);
  const defaultTierByExRef = useRef(defaultTierByEx);
  const supportedSetRef = useRef(supportedSet);
  const priceBucketRef = useRef<number | undefined>(priceBucket);
  const didInitialAutoSelectRef = useRef(false);
  const autoSelectPendingRef = useRef(false);
  const pausedRef = useRef(paused);
  const lastBookUpdateAtRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const calcStartedAtRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const upDownLatchRef = useRef<Record<ExchangeId, 'up' | 'down' | undefined>>(
    makeMap<'up' | 'down' | undefined>(undefined)
  );
  const firstDataDeadlineRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const booksRef = useRef(books);
  const costBreakdownMapRef = useRef(costBreakdownMap);
  const errorsRef = useRef(errors);
  const downSinceRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const sessionStartRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );
  const sessionDowntimeAccRef = useRef<Record<ExchangeId, number>>(makeMap<number>(0));
  const hasFlushedOnExitRef = useRef(false);

  useEffect(() => {
    prevTradingPairRef.current = tradingPairRef.current;
    tradingPairRef.current = tradingPair;
  }, [tradingPair]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    sizeAssetRef.current = sizeAsset;
  }, [sizeAsset]);
  useEffect(() => {
    sideRef.current = side;
  }, [side]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    defaultTierByExRef.current = defaultTierByEx;
  }, [defaultTierByEx]);
  useEffect(() => {
    supportedSetRef.current = supportedSet;
  }, [supportedSet]);
  useEffect(() => {
    priceBucketRef.current = priceBucket;
  }, [priceBucket]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    booksRef.current = books;
  }, [books]);
  useEffect(() => {
    costBreakdownMapRef.current = costBreakdownMap;
  }, [costBreakdownMap]);
  useEffect(() => {
    errorsRef.current = errors;
  }, [errors]);

  /**
   * Marks the specified exchange as down and starts tracking its downtime.
   * If the exchange is already being tracked as down, the function does nothing.
   *
   * @param id - The unique identifier of the exchange to track.
   * @param reason - Optional reason for the exchange downtime.
   */
  const startExchangeDowntimeTracking = (id: ExchangeId, reason?: string) => {
    if (downSinceRef.current[id] != null) return;
    downSinceRef.current[id] = Date.now();
    evtExchangeStatus({ exchange: id, status: 'down', reason });
  };

  /**
   * Marks the end of downtime tracking for a specific exchange.
   *
   * If the exchange was previously marked as down, calculates the duration of downtime,
   * resets the downtime tracking, and emits an event indicating the exchange is back up.
   *
   * @param id - The unique identifier of the exchange.
   * @param reason - (Optional) A string describing the reason for the status change.
   * @return The duration of the downtime in milliseconds, or `undefined` if the exchange was not marked as down.
   */
  const endExchangeDowntimeTracking = (id: ExchangeId, reason?: string): number | undefined => {
    const started = downSinceRef.current[id];
    if (started == null) return;
    const duration = Date.now() - started;
    downSinceRef.current[id] = undefined;
    evtExchangeStatus({ exchange: id, status: 'up', reason, down_duration_ms: duration });
    return duration;
  };

  /**
   * Ends an exchange session and generates a summary of the session metrics.
   *
   * @param id - The unique identifier of the exchange
   * @param reason - The reason for ending the session
   */
  const endSessionWithSummary = (id: ExchangeId, reason: string) => {
    const start = sessionStartRef.current[id];
    if (!start) {
      evtExchangeSessionEnd(id, reason);
      return;
    }

    const downSince = downSinceRef.current[id];
    if (typeof downSince === 'number') {
      sessionDowntimeAccRef.current[id] += Math.max(0, Date.now() - downSince);
      downSinceRef.current[id] = undefined;
    }

    const total = Math.max(0, Date.now() - start);
    const downtime = Math.max(0, sessionDowntimeAccRef.current[id] || 0);
    const uptimeRatio = total > 0 ? (total - downtime) / total : 1;

    const payload = {
      exchange: id,
      total_ms: Math.floor(total),
      downtime_ms: Math.floor(downtime),
      uptime_ratio: Math.max(0, Math.min(1, uptimeRatio)),
      reason,
      ts: Date.now(),
    };

    evtExchangeSessionSummary({
      exchange: payload.exchange,
      total_ms: payload.total_ms,
      downtime_ms: payload.downtime_ms,
      uptime_ratio: payload.uptime_ratio,
      reason,
    });
    evtExchangeSessionEnd(id, reason);

    sessionStartRef.current[id] = undefined;
    sessionDowntimeAccRef.current[id] = 0;
  };

  // Increment the operation sequence number for an exchange to invalidate stale async operations.
  const bumpSeq = useCallback((id: ExchangeId) => {
    opSeqRef.current[id] = (opSeqRef.current[id] ?? 0) + 1;
  }, []);

  // Clear cost calculation debounce timers per exchange
  const clearTimers = useCallback((id: ExchangeId) => {
    const t = recomputeTimers.current[id];
    if (t != null) {
      window.clearTimeout(t);
      recomputeTimers.current[id] = null;
    }
  }, []);

  // Clear UI and internal state trackers for an exchange
  const clearState = useCallback((id: ExchangeId) => {
    setBooks((prev) => ({ ...prev, [id]: undefined }));
    setCostBreakdownMap((prev) => ({ ...prev, [id]: undefined }));
    setErrors((prev) => ({ ...prev, [id]: null }));
    setCalcTimestamps((prev) => ({ ...prev, [id]: undefined }));
    lastBookUpdateAtRef.current[id] = undefined;
    calcStartedAtRef.current[id] = undefined;
    upDownLatchRef.current[id] = undefined;
    firstDataDeadlineRef.current[id] = undefined;
  }, []);

  // Call adapter's unwatch method safely
  const unwatchWithPairKey = useCallback((id: ExchangeId) => {
    try {
      EXCHANGE_REGISTRY[id].unwatchLivePair?.();
    } catch (e) {
      console.warn(`Error during unwatchLivePair for ${id}:`, e);
    }
  }, []);

  // Disconnect cleanly, only during deselection or unsupported exchange. Does NOT disconnect on trading pair changes.
  const disconnectExchange = useCallback(
    (id: ExchangeId, endReason?: string) => {
      if (hasFlushedOnExitRef.current) return;

      endSessionWithSummary(id, endReason ?? 'disconnect');

      if (isDisconnectingRef.current[id]) return;
      isDisconnectingRef.current[id] = true;

      try {
        bumpSeq(id);
        clearTimers(id);

        pairKeyByEx.current[id] = null;
        liveReadyRef.current[id] = false;

        // Unsubscribe UI listeners
        if (subsRef.current[id]) {
          try {
            subsRef.current[id]!();
          } catch (e) {
            console.warn(`Error unsubscribing UI listener for ${id}:`, e);
          }
          subsRef.current[id] = null;
        }

        // Disconnect full socket
        try {
          EXCHANGE_REGISTRY[id].disconnect!();
        } catch (e) {
          console.warn(`Error during disconnect for ${id}:`, e);
        }

        clearState(id);
      } catch (e) {
        console.warn(`Error during full disconnect of ${id}:`, e);
      } finally {
        isDisconnectingRef.current[id] = false;
      }
    },
    [bumpSeq, clearTimers, clearState]
  );

  // Debounce and schedule cost recalculation
  const scheduleRecompute = useCallback((id: ExchangeId) => {
    if (pausedRef.current) return;
    if (recomputeTimers.current[id] != null) return;
    calcStartedAtRef.current[id] = Date.now();

    recomputeTimers.current[id] = window.setTimeout(() => {
      recomputeTimers.current[id] = null;
      if (pausedRef.current) return;
      if (!selectedRef.current.includes(id)) return;
      if (!supportedSetRef.current.has(id)) return;
      if (!pairKeyByEx.current[id]) return;
      if (!liveReadyRef.current[id]) return;
      if (!tradingPairRef.current) return;
      if (sizeRef.current <= 0) return;

      void calculateCost(id);
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure subscribed only once per exchange
  const ensureSubscribed = useCallback(
    (id: ExchangeId) => {
      if (!selectedRef.current.includes(id)) return;
      if (!supportedSetRef.current.has(id)) return;
      if (subsRef.current[id]) return;

      const adapter = EXCHANGE_REGISTRY[id];
      subsRef.current[id] = adapter.onLiveBook((pairKey: string, book: OrderBook) => {
        if (pairKeyByEx.current[id] !== pairKey || pausedRef.current) return;
        liveReadyRef.current[id] = true;

        lastBookUpdateAtRef.current[id] = Date.now();
        const hasBook = (book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0;

        if (hasBook && upDownLatchRef.current[id] !== 'up') {
          upDownLatchRef.current[id] = 'up';
          const duration = endExchangeDowntimeTracking(id, 'book_resumed') ?? 0;
          if (duration > 0) sessionDowntimeAccRef.current[id] += duration;
        }

        setBooks((prev) => ({
          ...prev,
          [id]: { ...mapOrderBook(book), tradingPair: tradingPairRef.current },
        }));

        calcStartedAtRef.current[id] = Date.now();
        scheduleRecompute(id);
      });
    },
    [scheduleRecompute]
  );

  /**
   * Serializes async watch/unwatch operations per exchange by queuing operation Promises.
   * This prevents race conditions and ensures order:
   * unwatch completes before watch starts.
   */
  const enqueueWatchOperation = useCallback((id: ExchangeId, operation: () => Promise<void>) => {
    const prevPromise = watchMutexRef.current[id] || Promise.resolve();

    const newPromise = prevPromise
      .then(() => operation())
      .catch((e) => console.warn(`Watch operation error for ${id}:`, e));

    watchMutexRef.current[id] = newPromise;
    return newPromise;
  }, []);

  /**
   * Watches trading pair live data, serialized and guarded against races.
   * Waits for priceBucket, aborts if stale, disconnects properly if pair/bucket changes.
   */
  const watchPair = useCallback(
    (id: ExchangeId, base: string, quote: string) => {
      return enqueueWatchOperation(id, async () => {
        // Small delay to batch rapid calls
        await sleep(100);

        // Immediately exit if exchange no longer supports the trading pair at call time
        if (!supportedSetRef.current.has(id)) return;

        bumpSeq(id);
        const seqAtStart = opSeqRef.current[id];

        // Wait max ~750ms for priceBucket to become defined
        let attempts = 0;
        while (
          priceBucketRef.current === undefined &&
          attempts < 3 &&
          selectedRef.current.includes(id) &&
          supportedSetRef.current.has(id) &&
          seqAtStart === opSeqRef.current[id]
        ) {
          await sleep(250);
          attempts++;
        }

        if (
          opSeqRef.current[id] !== seqAtStart ||
          !selectedRef.current.includes(id) ||
          !supportedSetRef.current.has(id) ||
          !tradingPairRef.current ||
          priceBucketRef.current === undefined
        )
          return;

        const adapter = EXCHANGE_REGISTRY[id];
        const nextKey = adapter.getPairSymbol(base, quote);
        const prevKey = pairKeyByEx.current[id];
        const prevBucket = lastBucketByEx.current[id];
        const nextBucket = priceBucketRef.current;

        const samePair = prevKey === nextKey;
        const bucketChanged = prevBucket !== nextBucket;

        // Unwatch if trading pair or bucket changed, ensuring awaits for sequencing
        if ((prevKey && prevKey !== nextKey) || (samePair && bucketChanged)) {
          try {
            unwatchWithPairKey(id);
          } catch (e) {
            console.warn(`Error during unwatchLivePair for ${id}:`, e);
          }
          liveReadyRef.current[id] = false;
        }

        // Subscribe to new trading pair with new bucket
        await adapter.watchLivePair(nextKey, nextBucket);

        // Validate again after watchLivePair returns
        if (
          opSeqRef.current[id] !== seqAtStart ||
          !selectedRef.current.includes(id) ||
          !supportedSetRef.current.has(id) ||
          !tradingPairRef.current
        ) {
          try {
            unwatchWithPairKey(id);
          } catch (e) {
            console.warn(`Error during unwatchLivePair (stale) for ${id}:`, e);
          }
          liveReadyRef.current[id] = false;
          return;
        }

        pairKeyByEx.current[id] = nextKey;
        lastBucketByEx.current[id] = nextBucket;

        sessionStartRef.current[id] = Date.now();
        sessionDowntimeAccRef.current[id] = 0;
        evtExchangeSessionStart(id);

        // Set a deadline for first data to arrive, else mark as error
        firstDataDeadlineRef.current[id] = Date.now() + 10000;

        setErrors((prev) => ({ ...prev, [id]: null }));
        clearState(id);
      });
    },
    [bumpSeq, clearState, enqueueWatchOperation, unwatchWithPairKey]
  );

  // ON PAGE EXIT → flush all sessions
  useEffect(() => {
    const flushAll = (reason: string) => {
      if (hasFlushedOnExitRef.current) return;
      hasFlushedOnExitRef.current = true;
      selectedRef.current.forEach((id) => {
        if (sessionStartRef.current[id]) endSessionWithSummary(id, reason);
      });
    };

    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        flushAll('pagehide');
        event.preventDefault();
      }
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushAll('beforeunload');
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // ON UNMOUNT → fully disconnect all, clear timers
  useEffect(() => {
    const timersSnapshot = { ...recomputeTimers.current };
    return () => {
      allExchangeIds.forEach((id) => {
        endExchangeDowntimeTracking(id, 'unmount');
        void disconnectExchange(id);
      });
      Object.values(timersSnapshot).forEach((t) => t != null && window.clearTimeout(t));
    };
  }, [allExchangeIds, disconnectExchange]);

  // DESELECT → hard disconnect; SELECT → only if supported
  useEffect(() => {
    const prev = new Set(lastSelectedRef.current);
    const next = new Set(selected);
    const removed = [...prev].filter((id) => !next.has(id));
    const added = [...next].filter((id) => !prev.has(id));

    removed.forEach((id) => {
      const duration = endExchangeDowntimeTracking(id, 'deselected') ?? 0;
      if (duration > 0) sessionDowntimeAccRef.current[id] += duration;
      void disconnectExchange(id, 'deselected');
    });

    added.forEach(async (id) => {
      try {
        if (!tradingPairRef.current) return;

        if (!supportedSet.has(id)) {
          const duration = endExchangeDowntimeTracking(id, 'unsupported') ?? 0;
          if (duration > 0) sessionDowntimeAccRef.current[id] += duration;

          disconnectExchange(id, 'unsupported');
          setErrors((p) => ({
            ...p,
            [id]: `Exchange ${id} doesn't support ${tradingPairRef.current}`,
          }));
          return;
        }

        ensureSubscribed(id);
        const { base, quote } = parsePair(tradingPairRef.current);
        await watchPair(id, base, quote);
      } catch (e) {
        setErrors((p) => ({ ...p, [id]: String((e as Error)?.message || e) }));
      }
    });

    lastSelectedRef.current = selected;
  }, [selected, supportedSet, ensureSubscribed, disconnectExchange, watchPair]);

  // TRADING PAIR changes → fetch tick sizes for supported exchanges, set price bucket
  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!tradingPair) {
        if (active) setPriceBucket(undefined);
        return;
      }

      // wait 250ms for supportedRef to be updated
      await sleep(250);
      if (!active) return;

      const { base, quote } = parsePair(tradingPair);
      const eligible = selected.filter((id) => supportedSetRef.current.has(id));

      evtTradingPairSelected(tradingPair, base, quote);

      if (eligible.length === 0) {
        if (active) setPriceBucket(undefined);
        return;
      }

      const results = await Promise.allSettled(
        eligible.map(async (id) => {
          const cacheKey = `${id}:${base}/${quote}`;
          const cached = tickCacheRef.current[cacheKey];
          if (cached && cached > 0) return cached;

          const t = await EXCHANGE_REGISTRY[id].getTickSize?.(`${base}/${quote}`);
          if (t && t > 0) tickCacheRef.current[cacheKey] = t;
          return t ?? 0;
        })
      );
      if (!active) return;

      const ticks = results.map((r) => (r.status === 'fulfilled' ? (r.value ?? 0) : 0));
      const maxTick = ticks.reduce((m, t) => (t > m ? t : m), 0);
      setPriceBucket(maxTick || undefined);
    };

    run();

    return () => {
      active = false;
    };
  }, [tradingPair, selected, supportedSet]);

  // TRADING PAIR or SELECTED changes → open 10s windows, reset freshness map and emit exchanges_selected
  useEffect(() => {
    evtExchangesSelected(selected ?? []);

    const deadline = Date.now() + 10000;
    const next: Record<ExchangeId, number> = {} as Record<ExchangeId, number>;
    selected.forEach((id) => (next[id] = deadline));
    firstDataDeadlineRef.current = { ...firstDataDeadlineRef.current, ...next };

    upDownLatchRef.current = makeMap<'up' | 'down' | undefined>(undefined);
    lastBookUpdateAtRef.current = makeMap<number | undefined>(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingPair, selected]);

  // TRADING PAIR changes → watch all selected supported exchanges
  useEffect(() => {
    selectedRef.current.forEach(clearTimers);
    const skipThisCycle = autoSelectPendingRef.current;
    autoSelectPendingRef.current = false;

    const { base, quote } = parsePair(tradingPair);

    (async () => {
      if (!tradingPair) {
        selectedRef.current.forEach((id) => {
          endSessionWithSummary(id, 'trading_pair_cleared');
          const duration = endExchangeDowntimeTracking(id, 'trading_pair_cleared') ?? 0;
          if (duration > 0) sessionDowntimeAccRef.current[id] += duration;

          unwatchWithPairKey(id);
          pairKeyByEx.current[id] = null;
          liveReadyRef.current[id] = false;
          clearState(id);
        });
        return;
      }

      await Promise.all(
        selectedRef.current.map(async (id) => {
          try {
            if (!supportedSet.has(id)) {
              const duration = endExchangeDowntimeTracking(id, 'unsupported') ?? 0;
              if (duration > 0) sessionDowntimeAccRef.current[id] += duration;

              disconnectExchange(id, 'unsupported');
              setErrors((p) => ({ ...p, [id]: `Exchange ${id} doesn't support ${tradingPair}` }));
              return;
            }
            if (!skipThisCycle) {
              ensureSubscribed(id);
              await watchPair(id, base, quote);
            }
          } catch (e) {
            setErrors((p) => ({ ...p, [id]: String((e as Error)?.message || e) }));
          }
        })
      );
    })();
  }, [
    tradingPair,
    supportedSet,
    ensureSubscribed,
    disconnectExchange,
    watchPair,
    clearTimers,
    clearState,
    unwatchWithPairKey,
  ]);

  // PRICE BUCKET changes → watch all selected supported exchanges if bucket changed
  useEffect(() => {
    if (!tradingPairRef.current) return;
    if (priceBucket === undefined) return;

    const { base, quote } = parsePair(tradingPairRef.current);

    selected
      .filter((id) => supportedSet.has(id))
      .filter((id) => lastBucketByEx.current[id] !== priceBucket)
      .forEach((id) => {
        void watchPair(id, base, quote);
      });
  }, [priceBucket, selected, supportedSet, watchPair]);

  // SIZE, SIDE, SETTINGS changes → recalculate costs for all selected supported exchanges
  useEffect(() => {
    if (pausedRef.current) return;
    if (!tradingPairRef.current || size <= 0) return;

    selected
      .filter((id) => supportedSet.has(id))
      .filter((id) => !!pairKeyByEx.current[id])
      .filter((id) => liveReadyRef.current[id])
      .forEach((id) => void calculateCost(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, sizeAsset, side, settings, selected, supportedSet]);

  // PAUSED changes → if unpausing, recalculate costs for all selected supported exchanges
  useEffect(() => {
    if (paused) return;
    if (!tradingPairRef.current || sizeRef.current <= 0) return;

    selected
      .filter((id) => supportedSet.has(id))
      .filter((id) => !!pairKeyByEx.current[id])
      .filter((id) => liveReadyRef.current[id])
      .forEach((id) => void calculateCost(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, selected, supportedSet]);

  // TRADING PAIR changes → reset caches, price bucket, lastBucketByEx
  useEffect(() => {
    tickCacheRef.current = {};
    setPriceBucket(undefined);
    allExchangeIds.forEach((id) => (lastBucketByEx.current[id] = undefined));
  }, [tradingPair, allExchangeIds]);

  // TRADING PAIR changes → auto-select supported exchanges if none selected
  useEffect(() => {
    async function run() {
      if (!onSelectExchanges) return;

      await sleep(250);
      const prevSym = prevTradingPairRef.current ?? '';
      const isFirstNonEmpty = !prevSym && !!tradingPair;
      const nothingSelected = selected.length === 0;
      const hasSupport = supportedSet.size > 0;

      if (isFirstNonEmpty && nothingSelected && hasSupport && !didInitialAutoSelectRef.current) {
        const auto = allExchangeIds.filter((id) => supportedSet.has(id));
        if (auto.length > 0) {
          didInitialAutoSelectRef.current = true;
          autoSelectPendingRef.current = true;
          onSelectExchanges(auto);
        }
      }
    }
    void run();
  }, [tradingPair, selected.length, supportedSet, onSelectExchanges, allExchangeIds]);

  // UPTIME DOWN watcher: mark DOWN if no non-empty book within 10s
  useEffect(() => {
    if (!tradingPair) return;

    const t = window.setInterval(() => {
      const now = Date.now();
      const booksSnap = booksRef.current;

      selected.forEach((id) => {
        const dl = firstDataDeadlineRef.current[id];
        const book = booksSnap[id];
        const hasBook = !!book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0);
        if (!hasBook && dl && now >= dl && upDownLatchRef.current[id] !== 'down') {
          upDownLatchRef.current[id] = 'down';
          startExchangeDowntimeTracking(id, 'no_book_10s');
        }
      });
    }, 500);

    return () => window.clearInterval(t);
  }, [tradingPair, selected]);

  /**
   * Calculates the trading cost breakdown for a given exchange.
   *
   * This function checks if the exchange is supported, the trading pair is available,
   * and the exchange is ready for live calculations. It then retrieves the appropriate
   * adapter and user settings, and calls the adapter's `calculateCost` method with the
   * current order parameters. The resulting breakdown, timestamp, and any errors are
   * stored in state.
   *
   * @param id - The unique identifier of the exchange for which to calculate the cost.
   *
   * @remarks
   * - Updates cost breakdown, calculation timestamp, and error state for the given exchange.
   * - Handles errors gracefully and logs warnings if calculation fails.
   */
  async function calculateCost(id: ExchangeId) {
    if (pausedRef.current) return;
    if (!supportedSetRef.current.has(id)) return;

    const pairKey = pairKeyByEx.current[id];

    if (!pairKey) return;
    if (!liveReadyRef.current[id]) return;

    const adapter = EXCHANGE_REGISTRY[id];
    if (!tradingPairRef.current) return;

    const { base, quote } = parsePair(tradingPairRef.current);
    const tiers = defaultTierByExRef.current;
    const userTier = settingsRef.current[id]?.userTier || tiers?.[id];
    const wantsDiscount = !!settingsRef.current[id]?.tokenDiscount;
    const customFees = settingsRef.current[id]?.customFees;

    try {
      const lastAt = lastBookUpdateAtRef.current[id];
      if (typeof lastAt === 'number')
        evtOrderbookPushLatencyMs(id, Math.max(0, Math.floor(Date.now() - lastAt)));

      const breakdown = await adapter.calculateCost({
        pair: `${base}/${quote}`,
        orderSize: sizeRef.current,
        orderSizeAsset: sizeAssetRef.current,
        orderSide: sideRef.current.toLowerCase() as OrderSide,
        userTier,
        tokenDiscount: wantsDiscount,
        customFees,
      });

      const finishedAt = Date.now();

      setCostBreakdownMap((prev) => ({ ...prev, [id]: breakdown }));
      setCalcTimestamps((prev) => ({ ...prev, [id]: new Date(finishedAt) }));
      setErrors((prev) => ({ ...prev, [id]: null }));

      endExchangeDowntimeTracking(id, 'calc_ok');
      evtCalcLatencyMs(id, Math.max(0, finishedAt - (calcStartedAtRef.current[id] ?? finishedAt)));

      const currentSelected = selectedRef.current.slice();
      const mapNow = { ...costBreakdownMapRef.current, [id]: breakdown };
      const errorsNow = { ...errorsRef.current, [id]: null };

      const allSelectedReady =
        currentSelected.length >= 2 &&
        currentSelected.every((exId) => !!mapNow[exId] && !errorsNow[exId]);

      const rankedNow = calculateRankedExchanges(
        currentSelected,
        { ...costBreakdownMapRef.current, [id]: breakdown },
        { ...errorsRef.current, [id]: null },
        sideRef.current
      );

      if (allSelectedReady) {
        /* Compare Binance against the best alternative exchange and calculate the percentage difference. */
        const BINANCE_ID = 'Binance' as ExchangeId;
        const binanceSelected = currentSelected.includes(BINANCE_ID);
        const binanceIdx = binanceSelected ? rankedNow.indexOf(BINANCE_ID) : -1;
        const bestNow = rankedNow[0] ?? id;
        const runnerUp = rankedNow[1];

        let comparator: ExchangeId | undefined;
        if (binanceIdx >= 0) comparator = binanceIdx === 0 ? runnerUp : bestNow;

        let binanceVsComparatorPct = 0;
        if (binanceSelected && comparator) {
          const isBuy = side === 'buy';
          const map = { ...costBreakdownMapRef.current, [id]: breakdown };
          const binanceBreakdown = map[BINANCE_ID];
          const comparatorBreakdown = map[comparator];
          if (binanceBreakdown && comparatorBreakdown) {
            const savings = calculateSavings(
              binanceBreakdown,
              comparatorBreakdown,
              isBuy,
              base.toUpperCase(),
              quote.toUpperCase()
            );
            binanceVsComparatorPct = bestNow === BINANCE_ID ? savings.pct : -savings.pct;
          }
        }

        evtCalcPerformed({
          tradingPair: tradingPairRef.current,
          side: sideRef.current,
          quantity: sizeRef.current,
          sizeAsset: sizeAssetRef.current === 'base' ? base : quote,
          selectedExchanges: currentSelected,
          bestExchange: bestNow,
          bestExchangeAccountPrefs: settingsRef.current[bestNow] || {},
          binanceRank: binanceIdx >= 0 ? binanceIdx + 1 : -1,
          binanceComparator: comparator,
          binanceVsComparatorPct: binanceVsComparatorPct * 100,
        });
      }
    } catch (e: unknown) {
      console.warn(`Failed to calculate cost for ${id}:`, e);
      setCostBreakdownMap((prev) => ({ ...prev, [id]: undefined }));
      setErrors((prev) => ({
        ...prev,
        [id]:
          typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message?: unknown }).message)
            : String(e),
      }));
      startExchangeDowntimeTracking(id, 'calc_error');
    }
  }

  const rankedExchanges = calculateRankedExchanges(
    selected,
    costBreakdownMap,
    errors,
    sideRef.current
  );

  return {
    books,
    costBreakdownMap,
    errors,
    rankedExchanges,
    calcTimestamps,
    priceBucket,
  };
}
