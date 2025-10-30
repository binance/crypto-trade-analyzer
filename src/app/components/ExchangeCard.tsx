import { useEffect, useRef, useState, type JSX } from 'react';
import { ExternalLink } from 'lucide-react';
import { cryptoNumberFormat, getExchangeTradeHref, parsePair } from '../../utils/utils';
import { CornerRibbon } from './CornerRibbon';
import { AccountPreferences } from './AccountPreferences';
import { LiveOrderBook } from './LiveOrderBook';
import { Results } from './Results';
import { TradeBreakdown } from './TradeBreakdown';
import { TimestampDetails } from './TimestampDetails';
import { LIVE_ORDER_BOOK_DEPTH_ROWS } from '../../utils/constants';
import type { ExchangeId } from '../../exchanges';
import type { OrderBook, OrderSide } from '../../core/interfaces/order-book';
import type { OpenInfoKey, PerExchangeSettings } from '../types';
import type { CostBreakdown } from '../../core/interfaces/fee-config';

type ParsedLiquidity = {
  requested?: number;
  available?: number;
  side?: OrderSide;
  levels?: number;
  last?: number;
  sizeAsset?: string;
};

/**
 * Parses a liquidity error string and extracts relevant information into a `ParsedLiquidity` object.
 *
 * The function looks for the keyword "insufficient" in the error string, then attempts to parse
 * key-value pairs separated by the '|' character. Recognized keys include `requested`, `available`,
 * `side`, `levels`, and `last`. If either `requested` or `available` is present, a `ParsedLiquidity`
 * object is returned; otherwise, `null` is returned.
 *
 * @param err - The error string to parse, which may be `undefined` or `null`.
 * @returns A `ParsedLiquidity` object with extracted values, or `null` if parsing fails or no relevant data is found.
 */
const parseLiquidityError = (err?: string | null): ParsedLiquidity | null => {
  if (!err) return null;

  const i = err.toLowerCase().indexOf('insufficient');
  const seg = i >= 0 ? err.slice(i) : err;

  if (seg.includes('|')) {
    const obj: Record<string, string> = {};

    seg
      .split('|')
      .map((s) => s.trim())
      .forEach((s) => {
        const m = /^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(s);
        if (m) obj[m[1]] = m[2].trim();
      });

    const parsed: ParsedLiquidity = {
      requested: obj.requested ? Number(obj.requested) : undefined,
      available: obj.available ? Number(obj.available) : undefined,
      side: obj.side === 'buy' || obj.side === 'sell' ? (obj.side as OrderSide) : undefined,
      levels: obj.levels ? Number(obj.levels) : undefined,
      last: obj.last ? Number(obj.last) : undefined,
      sizeAsset: obj.sizeAsset ?? undefined,
    };
    if (parsed.requested != null || parsed.available != null) return parsed;
  }

  return null;
};

/**
 * Renders a card displaying exchange information, live order book, user preferences, and a detailed cost breakdown.
 *
 * @param exchangeId - The unique identifier for the exchange, or null if not set.
 * @param exchangeName - The display name of the exchange.
 * @param supportsTokenDiscount - Whether the exchange supports fee discounts via a token.
 * @param defaultTier - The default trading tier for the user.
 * @param userTiers - Optional list of available user trading tiers.
 * @param selectedExchanges - List of currently selected exchange IDs.
 * @param supportedExchanges - Set of exchange IDs that support the current trading pair.
 * @param isSelected - Whether this exchange is currently selected.
 * @param isBest - Whether this exchange offers the best trade for the current order.
 * @param rankedExchanges - List of exchange IDs ranked by cost for the current order.
 * @param books - Optional mapping of exchange IDs to their live order books.
 * @param costBreakdownMap - Mapping of exchange IDs to their respective cost breakdown data.
 * @param precision - Optional number of decimal places to display for prices.
 * @param error - Optional error message to display.
 * @param tradingPair - The trading pair for the order.
 * @param size - The order size for cost calculations.
 * @param settings - Optional user preferences/settings for this exchange.
 * @param lastCalculationTime - Optional timestamp of the last cost calculation.
 * @param paused - Whether cost calculations are currently paused.
 * @param onChangeSettings - Callback to update user preferences/settings.
 *
 * @returns A React component displaying exchange details, user preferences, and cost breakdown.
 */
export function ExchangeCard({
  exchangeId,
  exchangeName,
  supportsTokenDiscount,
  defaultTier,
  userTiers,
  selectedExchanges,
  supportedExchanges,
  isSelected,
  isBest,
  rankedExchanges,
  books,
  costBreakdownMap,
  precision,
  error,
  tradingPair,
  size,
  settings,
  lastCalculationTime,
  paused,
  onChangeSettings,
}: {
  exchangeName: string;
  exchangeId: ExchangeId;
  supportsTokenDiscount?: boolean;
  defaultTier: string;
  userTiers?: string[];
  selectedExchanges: ExchangeId[];
  supportedExchanges: Set<ExchangeId>;
  isSelected: boolean;
  isBest: boolean;
  rankedExchanges: ExchangeId[];
  books?: Record<ExchangeId, (OrderBook & { tradingPair: string }) | undefined>;
  costBreakdownMap: Record<ExchangeId, CostBreakdown>;
  precision?: number;
  error?: string | null;
  tradingPair: string;
  size: number;
  settings?: PerExchangeSettings;
  lastCalculationTime?: Date;
  paused?: boolean;
  onChangeSettings: (p: Partial<PerExchangeSettings>) => void;
}): JSX.Element {
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [openInfoKey, setOpenInfoKey] = useState<OpenInfoKey | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const [waitingForLiveOrderBook, setWaitingForLiveOrderBook] = useState(false);
  const waitingGateDeadlineRef = useRef<number>(0);
  const tradingPairRef = useRef<string>('');
  const hadBookRef = useRef(false);

  const book = exchangeId && books ? books[exchangeId] : undefined;
  const unsupported =
    !!exchangeId && exchangeId ? (tradingPair ? !supportedExchanges.has(exchangeId) : true) : false;
  const costBreakdown = costBreakdownMap[exchangeId as ExchangeId];
  const { base, quote } = parsePair(tradingPair);
  const tradeHref = getExchangeTradeHref(base, quote, exchangeName);
  const idx = Array.from({ length: LIVE_ORDER_BOOK_DEPTH_ROWS }, (_, i) => i);

  /* Reset waiting for live order book when trading pair changes */
  useEffect(() => {
    setWaitingForLiveOrderBook(true);
    waitingGateDeadlineRef.current = Date.now() + 10000;
    tradingPairRef.current = tradingPair;
  }, [tradingPair]);

  /* Detect when we lose the order book after having it */
  useEffect(() => {
    const hasBook = !!book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0);

    if (hadBookRef.current && !hasBook && isSelected && !unsupported) {
      setWaitingForLiveOrderBook(true);
      waitingGateDeadlineRef.current = Date.now() + 10000;
    }

    hadBookRef.current = hasBook;
  }, [book, isSelected, unsupported]);

  /* Wait for live order book data to arrive */
  useEffect(() => {
    if (!isSelected || unsupported) return;

    const targetIds = selectedExchanges.filter((id) => supportedExchanges.has(id));
    const hasSelections = selectedExchanges.length > 0;
    const supportsResolved = supportedExchanges.size > 0;

    const shouldWait =
      !!tradingPair && hasSelections && (targetIds.length > 0 || !supportsResolved);

    const readyNow =
      shouldWait &&
      targetIds.length > 0 &&
      targetIds.every((id) => {
        const book = books?.[id];
        return (
          !!book &&
          ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0) &&
          book.tradingPair === tradingPair
        );
      });

    const tick = () => {
      const timedOut = Date.now() >= waitingGateDeadlineRef.current;
      if (!shouldWait) {
        setWaitingForLiveOrderBook(false);
        return true;
      }

      if (readyNow || timedOut) {
        setWaitingForLiveOrderBook(false);
        return true;
      }
      return false;
    };

    if (tick()) return;
    const interval = setInterval(() => (tick() ? clearInterval(interval) : null), 110);
    return () => clearInterval(interval);
  }, [tradingPair, selectedExchanges, supportedExchanges, books, isSelected, unsupported]);

  return (
    <div
      className={[
        'card relative overflow-hidden min-w-0',
        isBest && !unsupported && !error && !waitingForLiveOrderBook && costBreakdown
          ? 'card-best'
          : '',
      ].join(' ')}
      data-ex={exchangeId ?? 'empty'}
    >
      {isBest && !unsupported && !error && !waitingForLiveOrderBook && costBreakdown && (
        <CornerRibbon label="Best" />
      )}

      {/* Header */}
      <div className="card-header flex items-center justify-between px-4 py-3 pr-14 sm:pr-20">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-semibold tracking-tight truncate">
            {isSelected ? exchangeName : '—'}{' '}
          </div>

          {isSelected && !unsupported && tradeHref && (
            <a
              href={tradeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium opacity-90 hover:opacity-100 underline underline-offset-2 focus:outline-none focus-visible:underline focus-visible:opacity-100 rounded-sm"
              aria-label={`Open ${base}/${quote} spot on ${exchangeName}`}
              title={`Open ${base}/${quote} on ${exchangeName} (spot)`}
            >
              {' '}
              Trade
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
        <div className="w-10 shrink-0" aria-hidden="true" />
      </div>

      {!isSelected ? (
        <div className="h-40 flex items-center justify-center text-muted text-sm">
          Not selected. Click on <span className="mx-1 underline">Exchanges</span> to add more.
        </div>
      ) : (
        <div className={unsupported ? 'pointer-events-none opacity-60' : ''}>
          <LiveOrderBook
            book={book}
            idx={idx}
            base={base}
            quote={quote}
            precision={precision}
            waitingForLiveOrderBook={waitingForLiveOrderBook}
          />

          <AccountPreferences
            settings={settings}
            prefsOpen={prefsOpen}
            userTiers={userTiers}
            defaultTier={defaultTier}
            supportsTokenDiscount={supportsTokenDiscount}
            onChangeSettings={onChangeSettings}
            setPrefsOpen={setPrefsOpen}
          />

          {/* Cost block */}
          <div className="section-subtle overflow-x-auto min-w-0">
            {!costBreakdown ? (
              (() => {
                if (!tradingPair || waitingForLiveOrderBook) return null;

                const hasSize = Number(size) > 0;
                const hasBook =
                  !!book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0);

                if (!hasSize) {
                  return (
                    <div className="text-muted text-sm">Enter an order size to calculate costs</div>
                  );
                }

                if (!hasBook && hasSize) return null;

                const liq = parseLiquidityError(error);
                if (liq) {
                  return (
                    <div
                      className="status-warn text-sm flex items-center gap-2"
                      role="alert"
                      aria-live="polite"
                    >
                      <span className="inline-block h-2 w-2 rounded-full bg-current" />
                      <span className="min-w-0">
                        Insufficient visible liquidity to fill your order.{' '}
                        {typeof liq.requested === 'number' && (
                          <>
                            Requested{' '}
                            <span className="font-mono tabular-nums">
                              {cryptoNumberFormat(liq.requested, { maxDecimals: 8 })}
                            </span>{' '}
                            <span> {liq.sizeAsset}</span>
                          </>
                        )}
                        {typeof liq.available === 'number' && (
                          <>
                            {', '}
                            available{' '}
                            <span className="font-mono tabular-nums">
                              {cryptoNumberFormat(liq.available, { maxDecimals: 8 })}
                            </span>{' '}
                            <span> {liq.sizeAsset}</span>
                          </>
                        )}
                        . Try a smaller size.
                      </span>
                    </div>
                  );
                }

                if (error) {
                  return (
                    <div
                      className="status-error text-sm flex items-center gap-2"
                      role="alert"
                      aria-live="polite"
                      title={error}
                    >
                      <span className="inline-block h-2 w-2 rounded-full bg-current" />
                      <span className="min-w-0">Couldn’t calculate cost: {error}</span>
                    </div>
                  );
                }

                if (paused) {
                  return <div className="text-muted text-sm">Cost calculation is paused</div>;
                }

                return (
                  <div
                    className="text-muted text-sm flex items-center gap-3"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="inline-block h-3 w-3 rounded-full border-2 ring-spinner animate-spin" />
                    Calculating costs…
                  </div>
                );
              })()
            ) : waitingForLiveOrderBook ? null : (
              <>
                <div className="space-y-6">
                  <Results
                    exchangeId={exchangeId}
                    costBreakdownMap={costBreakdownMap}
                    rankedExchanges={rankedExchanges}
                    paused={paused}
                    openInfoKey={openInfoKey}
                    setOpenInfoKey={setOpenInfoKey}
                  />

                  <div className="min-w-0">
                    <TradeBreakdown
                      exchangeId={exchangeId}
                      costBreakdownMap={costBreakdownMap}
                      precision={precision}
                      feesOpen={feesOpen}
                      openInfoKey={openInfoKey}
                      setFeesOpen={setFeesOpen}
                      setOpenInfoKey={setOpenInfoKey}
                      breakdownOpen={breakdownOpen}
                      setBreakdownOpen={setBreakdownOpen}
                    />
                  </div>

                  <div className="text-xs text-muted mt-2 text-right tabular">
                    {lastCalculationTime && (
                      <TimestampDetails
                        date={lastCalculationTime}
                        showTimestamp={true}
                        className="mt-2 block text-sm"
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Unsupported veil */}
      {isSelected && unsupported && (
        <div
          className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center text-muted text-sm veil-strong"
          aria-hidden="true"
        >
          {!tradingPair ? 'Select a trading pair' : `Not available for ${tradingPair}`}
        </div>
      )}

      {/* Live order book waiting for data overlay */}
      {isSelected && !unsupported && waitingForLiveOrderBook && (
        <div
          className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center text-muted text-sm veil-soft"
          role="status"
          aria-live="polite"
        >
          {paused ? (
            <span>Cost calculation is paused</span>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-block h-4 w-4 rounded-full border-2 ring-spinner animate-spin" />
              <span>Waiting for live order book…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
