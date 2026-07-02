import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRegistry, SPOT_REGISTRY, type ExchangeId } from '../../exchanges';
import type {
  MarketType,
  OrderBook,
  OrderSide,
  OrderSizeAsset,
} from '../../core/interfaces/order-book';
import type { PerExchangeSettings } from '../types';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import {
  bucketizeOrderBook,
  inferBookTick,
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
import { ORDERBOOK_STALE_MS } from '../../utils/constants';

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
  marketType?: MarketType;
  holdingPeriodHours?: number;
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
    marketType = 'spot',
    holdingPeriodHours,
    paused = false,
    onSelectExchanges,
  } = params;

  const allExchangeIds = useMemo(() => Object.keys(SPOT_REGISTRY) as ExchangeId[], []);
  const marketTypeRef = useRef<MarketType>(marketType);
  const holdingPeriodHoursRef = useRef<number | undefined>(holdingPeriodHours);
  const adapterFor = useCallback((id: ExchangeId) => getRegistry(marketTypeRef.current)[id], []);

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
  // Per-exchange tick used for DISPLAY only (order book + price precision). Equals priceBucket
  // for normal pairs; for futures tick-mismatch pairs it's each exchange's own native tick.
  const [displayTickByEx, setDisplayTickByEx] = useState<Record<ExchangeId, number | undefined>>(
    () => makeMap<number | undefined>(undefined)
  );
  // Ref mirror of displayTickByEx so the live-book callback can detect changes without re-subscribing.
  const displayTickByExRef = useRef<Record<ExchangeId, number | undefined>>(
    makeMap<number | undefined>(undefined)
  );

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
  // Whether advertised ticks diverge by >= 100× (futures only). When true, each card's display
  // book is bucketed to the tick inferred from its raw live book instead of the shared maxTick
  // grid. Cost calc is unaffected — it always uses the shared maxTick.
  const tickMismatchRef = useRef(false);
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
  const staleSinceRef = useRef<Record<ExchangeId, number | undefined>>(
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
  const isPageActiveRef = useRef(true);
  const isOnlineRef = useRef(true);
  const recoveringFromOfflineRef = useRef(false);

  type BookValue = (OrderBook & { tradingPair: string }) | undefined;
  const pendingBooksRef = useRef<Map<ExchangeId, BookValue>>(new Map());
  const pendingCostRef = useRef<Map<ExchangeId, CostBreakdown | undefined>>(new Map());
  const pendingErrorsRef = useRef<Map<ExchangeId, string | null>>(new Map());
  const pendingTsRef = useRef<Map<ExchangeId, Date | undefined>>(new Map());
  const flushRafRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    if (flushRafRef.current != null) {
      window.cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }

    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const books = pendingBooksRef.current;
    const costs = pendingCostRef.current;
    const errs = pendingErrorsRef.current;
    const ts = pendingTsRef.current;

    if (books.size) {
      pendingBooksRef.current = new Map();
      setBooks((prev) => {
        const next = { ...prev };
        books.forEach((v, id) => (next[id] = v));
        return next;
      });
    }

    if (costs.size) {
      pendingCostRef.current = new Map();
      setCostBreakdownMap((prev) => {
        const next = { ...prev };
        costs.forEach((v, id) => (next[id] = v));
        return next;
      });
    }

    if (errs.size) {
      pendingErrorsRef.current = new Map();
      setErrors((prev) => {
        const next = { ...prev };
        errs.forEach((v, id) => (next[id] = v));
        return next;
      });
    }

    if (ts.size) {
      pendingTsRef.current = new Map();
      setCalcTimestamps((prev) => {
        const next = { ...prev };
        ts.forEach((v, id) => (next[id] = v));
        return next;
      });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null || flushTimerRef.current != null) return;

    flushRafRef.current = window.requestAnimationFrame(flushPending);
    flushTimerRef.current = window.setTimeout(flushPending, 250);
  }, [flushPending]);

  const queueUiUpdate = useCallback(
    (
      id: ExchangeId,
      update: {
        book?: BookValue;
        cost?: CostBreakdown | undefined;
        error?: string | null;
        ts?: Date | undefined;
      }
    ) => {
      if ('book' in update) pendingBooksRef.current.set(id, update.book);
      if ('cost' in update) pendingCostRef.current.set(id, update.cost);
      if ('error' in update) pendingErrorsRef.current.set(id, update.error ?? null);
      if ('ts' in update) pendingTsRef.current.set(id, update.ts);

      scheduleFlush();
    },
    [scheduleFlush]
  );

  const dropPendingUi = useCallback((id: ExchangeId) => {
    pendingBooksRef.current.delete(id);
    pendingCostRef.current.delete(id);
    pendingErrorsRef.current.delete(id);
    pendingTsRef.current.delete(id);
  }, []);

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
    holdingPeriodHoursRef.current = holdingPeriodHours;
  }, [holdingPeriodHours]);
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
   * Check if page is active at the moment
   */
  const computeIsPageActive = () => document.visibilityState === 'visible';

  /**
   * Marks the specified exchange as down and starts tracking its downtime.
   * If the exchange is already being tracked as down, the function does nothing.
   *
   * @param id - The unique identifier of the exchange to track.
   * @param reason - Optional reason for the exchange downtime.
   */
  const startExchangeDowntimeTracking = (id: ExchangeId, reason?: string) => {
    if (!isPageActiveRef.current) return;
    if (downSinceRef.current[id] != null) return;
    downSinceRef.current[id] = Date.now();
    if (isPageActiveRef.current)
      evtExchangeStatus({ exchange: id, status: 'down', reason, market: marketTypeRef.current });
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
    if (isPageActiveRef.current)
      evtExchangeStatus({
        exchange: id,
        status: 'up',
        reason,
        down_duration_ms: duration,
        market: marketTypeRef.current,
      });
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
      if (isPageActiveRef.current) evtExchangeSessionEnd(id, marketTypeRef.current, reason);
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

    if (isPageActiveRef.current) {
      evtExchangeSessionSummary({
        exchange: payload.exchange,
        total_ms: payload.total_ms,
        downtime_ms: payload.downtime_ms,
        uptime_ratio: payload.uptime_ratio,
        reason,
        market: marketTypeRef.current,
      });
      evtExchangeSessionEnd(id, marketTypeRef.current, reason);
    }

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
  const clearState = useCallback(
    (id: ExchangeId) => {
      dropPendingUi(id);
      costBreakdownMapRef.current = { ...costBreakdownMapRef.current, [id]: undefined };
      errorsRef.current = { ...errorsRef.current, [id]: null };
      setBooks((prev) => ({ ...prev, [id]: undefined }));
      setCostBreakdownMap((prev) => ({ ...prev, [id]: undefined }));
      setErrors((prev) => ({ ...prev, [id]: null }));
      setCalcTimestamps((prev) => ({ ...prev, [id]: undefined }));
      lastBookUpdateAtRef.current[id] = undefined;
      calcStartedAtRef.current[id] = undefined;
      upDownLatchRef.current[id] = undefined;
      firstDataDeadlineRef.current[id] = undefined;
    },
    [dropPendingUi]
  );

  // Call adapter's unwatch method safely
  const unwatchWithPairKey = useCallback(
    (id: ExchangeId) => {
      try {
        adapterFor(id)?.unwatchLivePair?.();
      } catch (e) {
        console.warn(`Error during unwatchLivePair for ${id}:`, e);
      }
    },
    [adapterFor]
  );

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
          adapterFor(id)?.disconnect?.();
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
    [bumpSeq, clearTimers, clearState, adapterFor]
  );

  // Debounce and schedule cost recalculation
  const scheduleRecompute = useCallback((id: ExchangeId) => {
    if (pausedRef.current || !isPageActiveRef.current) return;
    if (recomputeTimers.current[id] != null) return;

    recomputeTimers.current[id] = window.setTimeout(() => {
      recomputeTimers.current[id] = null;
      if (pausedRef.current) return;
      if (!selectedRef.current.includes(id)) return;
      if (!supportedSetRef.current.has(id)) return;
      if (!pairKeyByEx.current[id]) return;
      if (!liveReadyRef.current[id]) return;
      if (!tradingPairRef.current) return;
      if (sizeRef.current <= 0) return;

      calcStartedAtRef.current[id] = Date.now();
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

      const adapter = adapterFor(id);
      if (!adapter) return;
      subsRef.current[id] = adapter.onLiveBook((pairKey: string, book: OrderBook) => {
        if (pairKeyByEx.current[id] !== pairKey || pausedRef.current) return;
        liveReadyRef.current[id] = true;

        lastBookUpdateAtRef.current[id] = Date.now();
        const hasBook = (book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0;

        if (hasBook) {
          staleSinceRef.current[id] = undefined;

          if (isPageActiveRef.current && upDownLatchRef.current[id] !== 'up') {
            upDownLatchRef.current[id] = 'up';
            const duration = endExchangeDowntimeTracking(id, 'book_resumed') ?? 0;
            if (duration > 0) sessionDowntimeAccRef.current[id] += duration;
          }
        }

        // For futures pairs with a large tick mismatch, the shared maxTick grid collapses finer
        // books into a few levels AND makes the simulated fill land on a coarse, inaccurate price.
        // Infer the book's true granularity from its raw price spacing (the advertised PRICE_FILTER
        // tick can be misleading — e.g. Binance fapi reports 0.10 for XLMUSDT while the book trades
        // at 0.00001) and apply it to BOTH the display and the cost grid, so Avg Price / Spend /
        // Receive reflect the real book. The fine ticks across venues are effectively identical, so
        // the cross-exchange comparison stays fair.
        let displayBook = book;
        if (tickMismatchRef.current) {
          const rawBook = adapter.getRawOrderBook(pairKey);
          const inferredTick = rawBook ? inferBookTick(rawBook) : undefined;
          if (rawBook && inferredTick && inferredTick > 0) {
            displayBook = bucketizeOrderBook(rawBook, inferredTick);
            if (displayTickByExRef.current[id] !== inferredTick) {
              displayTickByExRef.current[id] = inferredTick;
              setDisplayTickByEx((prev) => ({ ...prev, [id]: inferredTick }));
              // Re-grid the cost calc to the same real tick so the next calculateCost is accurate.
              adapter.setPriceBucket(inferredTick);
            }
          }
        }

        queueUiUpdate(id, {
          book: { ...mapOrderBook(displayBook), tradingPair: tradingPairRef.current },
        });

        scheduleRecompute(id);
      });
    },
    [scheduleRecompute, adapterFor, queueUiUpdate]
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

        const adapter = adapterFor(id);
        if (!adapter) return;
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

        if (!sessionStartRef.current[id]) {
          sessionStartRef.current[id] = Date.now();
          sessionDowntimeAccRef.current[id] = 0;
          if (isPageActiveRef.current) evtExchangeSessionStart(id, marketTypeRef.current);
        }

        // Set a deadline for first data to arrive, else mark as error
        clearState(id);
        firstDataDeadlineRef.current[id] = Date.now() + 10000;
        setErrors((prev) => ({ ...prev, [id]: null }));
      });
    },
    [bumpSeq, clearState, enqueueWatchOperation, unwatchWithPairKey, adapterFor]
  );

  // Soft reconnect for stale books: keep session but reset WS + state
  const softReconnectExchange = useCallback(
    async (id: ExchangeId, base: string, quote: string) => {
      if (isDisconnectingRef.current[id]) return;
      isDisconnectingRef.current[id] = true;

      try {
        bumpSeq(id);
        const seqAtStart = opSeqRef.current[id];

        clearTimers(id);

        if (subsRef.current[id]) {
          try {
            subsRef.current[id]!();
          } catch (e) {
            console.warn(`Error unsubscribing UI listener for ${id} during soft reconnect:`, e);
          }
          subsRef.current[id] = null;
        }

        try {
          unwatchWithPairKey(id);
        } catch (e) {
          console.warn(`Error during unwatchLivePair for ${id} during soft reconnect:`, e);
        }

        try {
          await adapterFor(id)?.disconnect?.();
        } catch (e) {
          console.warn(`Error during disconnect for stale ${id}:`, e);
        }

        pairKeyByEx.current[id] = null;
        liveReadyRef.current[id] = false;
        clearState(id);

        // give the socket a moment to fully close before reconnecting; jitter avoids herd
        const jitter = 250 + Math.floor(Math.random() * 250); // 250–500ms
        await sleep(jitter);

        // abort if something changed meanwhile
        if (
          opSeqRef.current[id] !== seqAtStart ||
          pausedRef.current ||
          !selectedRef.current.includes(id) ||
          !supportedSetRef.current.has(id) ||
          !tradingPairRef.current
        ) {
          return;
        }

        ensureSubscribed(id);
        await watchPair(id, base, quote);
      } finally {
        isDisconnectingRef.current[id] = false;
      }
    },
    [bumpSeq, clearState, clearTimers, ensureSubscribed, unwatchWithPairKey, watchPair, adapterFor]
  );

  // ON PAGE INACTIVE → set page as inactive
  useEffect(() => {
    const onActiveChange = (active: boolean) => {
      const wasActive = isPageActiveRef.current;
      if (wasActive === active) return;
      isPageActiveRef.current = active;
    };

    const handleVisibility = () => onActiveChange(computeIsPageActive());
    document.addEventListener('visibilitychange', handleVisibility, { capture: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // ON NETWORK FLAPPING → trigger reconnection if needed
  useEffect(() => {
    const handleOnline = async () => {
      const wasOnline = isOnlineRef.current;
      const online =
        typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? navigator.onLine
          : true;
      if (wasOnline === online) return;
      isOnlineRef.current = online;

      if (online) {
        recoveringFromOfflineRef.current = true;
        await sleep(5000);
        recoveringFromOfflineRef.current = false;
      }
    };
    const handleOffline = () => {
      const online =
        typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? navigator.onLine
          : false;
      if (online === isOnlineRef.current) return;
      isOnlineRef.current = online;
      if (!online) recoveringFromOfflineRef.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [softReconnectExchange]);

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

    const onFreeze = () => flushAll('freeze');

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushAll('beforeunload');
      event.preventDefault();
      event.returnValue = '';
    };

    document.addEventListener('freeze', onFreeze, { capture: true });
    window.addEventListener('pagehide', onPageHide, { capture: true });
    window.addEventListener('beforeunload', onBeforeUnload, { capture: true });

    return () => {
      document.removeEventListener('freeze', onFreeze);
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

      if (flushRafRef.current != null) window.cancelAnimationFrame(flushRafRef.current);
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
    };
  }, [allExchangeIds, disconnectExchange]);

  useEffect(() => {
    if (marketTypeRef.current === marketType) return;

    const prevMarket = marketTypeRef.current;
    const prevRegistry = getRegistry(prevMarket);

    allExchangeIds.forEach((id) => {
      endSessionWithSummary(id, 'market_changed');
      endExchangeDowntimeTracking(id, 'market_changed');
      clearTimers(id);

      if (subsRef.current[id]) {
        try {
          subsRef.current[id]!();
        } catch (e) {
          console.warn(`Error unsubscribing UI listener for ${id} on market change:`, e);
        }
        subsRef.current[id] = null;
      }

      try {
        prevRegistry[id]?.disconnect?.();
      } catch (e) {
        console.warn(`Error disconnecting ${id} on market change:`, e);
      }

      bumpSeq(id);
      pairKeyByEx.current[id] = null;
      lastBucketByEx.current[id] = undefined;
      liveReadyRef.current[id] = false;
      clearState(id);
    });

    tickCacheRef.current = {};
    setPriceBucket(undefined);

    marketTypeRef.current = marketType;
  }, [marketType, allExchangeIds, bumpSeq, clearTimers, clearState]);

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

      if (isPageActiveRef.current)
        evtTradingPairSelected(tradingPair, base, quote, marketTypeRef.current);

      if (eligible.length === 0) {
        if (active) setPriceBucket(undefined);
        return;
      }

      const results = await Promise.allSettled(
        eligible.map(async (id) => {
          const cacheKey = `${marketTypeRef.current}:${id}:${base}/${quote}`;
          const cached = tickCacheRef.current[cacheKey];
          if (cached && cached > 0) return cached;

          const t = await adapterFor(id)?.getTickSize?.(`${base}/${quote}`);
          if (t && t > 0) tickCacheRef.current[cacheKey] = t;
          return t ?? 0;
        })
      );
      if (!active) return;

      const ticks = results.map((r) => (r.status === 'fulfilled' ? (r.value ?? 0) : 0));
      const maxTick = ticks.reduce((m, t) => (t > m ? t : m), 0);

      // Detect futures tick mismatch (advertised max/min ratio >= 100). When mismatched, the live
      // book is shown at its inferred real granularity (computed per-update in the onLiveBook
      // callback) instead of the shared maxTick grid. Spot and well-matched pairs keep maxTick.
      const positiveTicks = ticks.filter((t) => t > 0);
      const minTick = positiveTicks.length > 0 ? Math.min(...positiveTicks) : 0;
      const mismatch =
        marketTypeRef.current === 'futures' && minTick > 0 && maxTick / minTick >= 100;
      tickMismatchRef.current = mismatch;

      // Seed display tick = shared maxTick grid. For mismatch pairs the callback overrides each
      // card with the tick inferred from its live book once data arrives.
      const seed = {} as Record<ExchangeId, number | undefined>;
      eligible.forEach((id) => {
        seed[id] = maxTick || undefined;
      });
      displayTickByExRef.current = mismatch
        ? ({} as Record<ExchangeId, number | undefined>)
        : { ...seed };
      setDisplayTickByEx(seed);

      setPriceBucket(maxTick || undefined);
    };

    run();

    return () => {
      active = false;
    };
  }, [tradingPair, selected, supportedSet, marketType, adapterFor]);

  // TRADING PAIR or SELECTED changes → open 10s windows, reset freshness map and emit exchanges_selected
  useEffect(() => {
    if (isPageActiveRef.current) evtExchangesSelected(selected ?? [], marketTypeRef.current);

    const deadline = Date.now() + 10000;
    const next: Record<ExchangeId, number> = {} as Record<ExchangeId, number>;

    selected.filter((id) => supportedSetRef.current.has(id)).forEach((id) => (next[id] = deadline));

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
      .forEach((id) => {
        calcStartedAtRef.current[id] = Date.now();
        void calculateCost(id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, sizeAsset, side, settings, selected, supportedSet, holdingPeriodHours]);

  // PAUSED changes → if unpausing, recalculate costs for all selected supported exchanges
  useEffect(() => {
    if (paused) return;
    if (!tradingPairRef.current || sizeRef.current <= 0) return;

    selected
      .filter((id) => supportedSet.has(id))
      .filter((id) => !!pairKeyByEx.current[id])
      .filter((id) => liveReadyRef.current[id])
      .forEach((id) => {
        calcStartedAtRef.current[id] = Date.now();
        void calculateCost(id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, selected, supportedSet]);

  // TRADING PAIR changes → reset caches, price bucket, lastBucketByEx
  useEffect(() => {
    tickCacheRef.current = {};
    tickMismatchRef.current = false;
    displayTickByExRef.current = {} as Record<ExchangeId, number | undefined>;
    setPriceBucket(undefined);
    setDisplayTickByEx({} as Record<ExchangeId, number | undefined>);
    allExchangeIds.forEach((id) => {
      lastBucketByEx.current[id] = undefined;
    });
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
      if (pausedRef.current) return;

      const now = Date.now();
      const booksSnap = booksRef.current;

      selected.forEach((id) => {
        if (!supportedSetRef.current.has(id)) return;
        if (!pairKeyByEx.current[id]) return;

        const dl = firstDataDeadlineRef.current[id];
        const book = booksSnap[id];
        const hasBook = !!book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0);
        if (
          isPageActiveRef.current &&
          !hasBook &&
          dl &&
          now >= dl &&
          upDownLatchRef.current[id] !== 'down'
        ) {
          upDownLatchRef.current[id] = 'down';
          startExchangeDowntimeTracking(id, 'no_book_10s');
        }
      });
    }, 500);

    return () => window.clearInterval(t);
  }, [tradingPair, selected]);

  // STALE ORDERBOOK watcher
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isOnlineRef.current || recoveringFromOfflineRef.current) return;
      const pair = tradingPairRef.current;
      if (!pair) return;
      if (pausedRef.current) return;

      const now = Date.now();
      const { base, quote } = parsePair(pair);

      selectedRef.current.forEach((id) => {
        if (!supportedSetRef.current.has(id)) return;
        if (!pairKeyByEx.current[id]) return;

        const last = lastBookUpdateAtRef.current[id];
        if (typeof last !== 'number') return;
        if (now - last <= ORDERBOOK_STALE_MS) return;

        if (staleSinceRef.current[id] != null) return;
        staleSinceRef.current[id] = now;

        console.warn(
          `Orderbook for ${id} considered stale (${now - last}ms since last update) – soft reconnect`
        );

        firstDataDeadlineRef.current[id] = Date.now() + 10000;
        softReconnectExchange(id, base, quote);
      });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [softReconnectExchange]);

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
    if (pausedRef.current || !isPageActiveRef.current) return;
    if (!supportedSetRef.current.has(id)) return;

    const pairKey = pairKeyByEx.current[id];

    if (!pairKey) return;
    if (!liveReadyRef.current[id]) return;

    const adapter = adapterFor(id);
    if (!adapter) return;
    if (!tradingPairRef.current) return;

    const { base, quote } = parsePair(tradingPairRef.current);
    const tiers = defaultTierByExRef.current;
    const userTier = settingsRef.current[id]?.userTier || tiers?.[id];
    const wantsDiscount = !!settingsRef.current[id]?.tokenDiscount;
    const customFees = settingsRef.current[id]?.customFees;

    try {
      const lastAt = lastBookUpdateAtRef.current[id];
      if (typeof lastAt === 'number' && isPageActiveRef.current)
        evtOrderbookPushLatencyMs(
          id,
          Math.max(0, Math.floor(Date.now() - lastAt)),
          marketTypeRef.current
        );

      const startAt = calcStartedAtRef.current[id] ?? Date.now();

      const breakdown = await adapter.calculateCost({
        pair: `${base}/${quote}`,
        orderSize: sizeRef.current,
        orderSizeAsset: sizeAssetRef.current,
        orderSide: sideRef.current.toLowerCase() as OrderSide,
        userTier,
        tokenDiscount: wantsDiscount,
        customFees,
        holdingPeriodHours: holdingPeriodHoursRef.current,
      });

      const finishedAt = Date.now();

      costBreakdownMapRef.current = { ...costBreakdownMapRef.current, [id]: breakdown };
      errorsRef.current = { ...errorsRef.current, [id]: null };
      queueUiUpdate(id, { cost: breakdown, error: null, ts: new Date(finishedAt) });

      if (isPageActiveRef.current)
        evtCalcLatencyMs(id, Math.max(0, finishedAt - startAt), marketTypeRef.current);

      const currentSelected = selectedRef.current.slice();
      const mapNow = { ...costBreakdownMapRef.current, [id]: breakdown };
      const errorsNow = { ...errorsRef.current, [id]: null };
      const selectedAndSupported = currentSelected.filter((exId) =>
        supportedSetRef.current.has(exId)
      );

      const allSelectedReady =
        selectedAndSupported.length >= 2 &&
        selectedAndSupported.every((exId) => !!mapNow[exId] && !errorsNow[exId]);

      const rankedNow = calculateRankedExchanges(
        selectedAndSupported,
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

        let binanceVsComparatorPct;
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
            binanceVsComparatorPct = savings.pct >= 0 && savings.pct <= 1 ? savings.pct : undefined;
          }
        }

        if (isPageActiveRef.current)
          evtCalcPerformed({
            tradingPair: tradingPairRef.current,
            side: sideRef.current,
            quantity: sizeRef.current,
            sizeAsset: sizeAssetRef.current === 'base' ? base : quote,
            selectedExchanges: selectedAndSupported,
            bestExchange: bestNow,
            bestExchangeAccountPrefs: settingsRef.current[bestNow] || {},
            binanceRank: binanceIdx >= 0 ? binanceIdx + 1 : -1,
            binanceComparator: comparator,
            binanceWinningPct: bestNow === BINANCE_ID ? binanceVsComparatorPct : 0,
            binanceLosingPct: bestNow !== BINANCE_ID ? binanceVsComparatorPct : 0,
            market: marketTypeRef.current,
          });
      }
    } catch (e: unknown) {
      console.warn(`Failed to calculate cost for ${id}:`, e);
      const message =
        typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message?: unknown }).message)
          : String(e);
      costBreakdownMapRef.current = { ...costBreakdownMapRef.current, [id]: undefined };
      errorsRef.current = { ...errorsRef.current, [id]: message };
      queueUiUpdate(id, { cost: undefined, error: message });
    } finally {
      calcStartedAtRef.current[id] = undefined;
    }
  }

  const nowTs = Date.now();
  const selectedAndSupported = selected.filter((id) => supportedSet.has(id));
  const freshSelected = selectedAndSupported.filter((id) => {
    const last = lastBookUpdateAtRef.current[id];
    return typeof last === 'number' && nowTs - last <= ORDERBOOK_STALE_MS;
  });

  const rankedExchanges = calculateRankedExchanges(
    freshSelected,
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
    displayTickByEx,
  };
}
