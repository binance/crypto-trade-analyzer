import { createPortal } from 'react-dom';
import { CostRow } from './CostRow';
import { InfoDot } from './InfoDot';
import { useSavedVs } from '../hooks/useSavedVs';
import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { ExchangeId } from '../../exchanges';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { OpenInfoKey } from '../types';

/**
 * Displays the results of a crypto exchange trade comparison, including net amount received,
 * total USD spent, and savings versus other selected exchanges.
 *
 * @param exchangeId - The ID of the exchange for which results are displayed.
 * @param costBreakdownMap - A mapping of exchange IDs to their respective cost breakdowns.
 * @param rankedExchanges - An array of exchange IDs ranked by cost efficiency.
 * @param paused - Indicates if the comparison is currently paused.
 * @param openInfoKey - The key indicating which info card is currently open.
 * @param setOpenInfoKey - Setter for toggling the open info card.
 *
 * @returns A JSX element rendering the trade results, spend/receive breakdown, and comparison dropdown.
 */
export function Results({
  exchangeId,
  costBreakdownMap,
  rankedExchanges,
  paused,
  openInfoKey,
  setOpenInfoKey,
}: {
  exchangeId: ExchangeId;
  costBreakdownMap: Record<ExchangeId, CostBreakdown | undefined>;
  rankedExchanges: ExchangeId[];
  paused: boolean | undefined;
  openInfoKey: OpenInfoKey | null;
  setOpenInfoKey: React.Dispatch<React.SetStateAction<OpenInfoKey | null>>;
}): JSX.Element {
  const [showExchangeName, setShowExchangeName] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const costBreakdown = costBreakdownMap[exchangeId]!;
  const isBuy = costBreakdown.side === 'buy';
  const receivedAsset = isBuy
    ? costBreakdown.baseAsset.toUpperCase()
    : costBreakdown.quoteAsset.toUpperCase();
  const receivedAmount = isBuy ? costBreakdown.netBaseReceived : costBreakdown.netQuoteReceived;
  const spendUsd = costBreakdown.totalTradeUsd;

  const { peers, compareId, setCompareId, savedUsd, dropdown } = useSavedVs({
    exchangeId,
    costBreakdownMap,
    rankedExchanges,
    paused,
  });

  // Intersection Observer to detect when the header is hidden
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    let sentinelTop = 0;

    const measure = () => {
      const rect = sentinel.getBoundingClientRect();
      sentinelTop = rect.top + window.scrollY;
    };

    const compute = () => {
      const vv = window.visualViewport;
      const viewportTop = vv ? vv.pageTop : window.scrollY;
      setShowExchangeName(viewportTop >= sentinelTop - 580);
    };

    const onScroll = () => requestAnimationFrame(compute);

    // initial measure + compute
    measure();
    compute();

    // re-measure on resize/zoom and orientation changes
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('orientationchange', measure);
    window.addEventListener('scroll', onScroll, { passive: true });

    // visualViewport change events (iOS address bar show/hide)
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.removeEventListener('scroll', onScroll);
      if (vv) vv.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <section className="w-full text-sm text-strong">
      {/* Invisible sentinel to detect when card header is hidden */}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />

      <div className="px-0 pb-2">
        <h3 className="text-muted font-medium flex items-center gap-2 will-change-transform [transform:translateZ(0)]">
          Results{showExchangeName ? <span className="sm:hidden">({exchangeId})</span> : ''}
        </h3>
        <div className="mt-2 h-px bg-black/10 dark:bg-white/10" />
      </div>

      <dl className="grid grid-cols-[1fr_16ch] gap-x-3">
        {/* Receive (net) */}
        <div className="col-span-2 font-semibold flex items-center justify-between py-1.5 transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
          <CostRow
            label="Receive (net)"
            onInfo={() => setOpenInfoKey((k) => (k === 'Receive' ? null : 'Receive'))}
          />
          <span className="shrink-0 font-mono tabular-nums whitespace-nowrap">
            {cryptoNumberFormat(receivedAmount)} {receivedAsset}
          </span>
        </div>

        {openInfoKey === 'Receive' && (
          <div className="col-span-2 mt-1 mb-1 info-card text-sm">
            Net amount you end up receiving from this trade. It already reflects price impact and
            fees.
          </div>
        )}

        {/* Spend */}
        <div className="col-span-2 font-semibold flex items-center justify-between py-1.5 transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
          <CostRow
            label="Spend"
            onInfo={() => setOpenInfoKey((k) => (k === 'Spend' ? null : 'Spend'))}
          />
          <span className="shrink-0 font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {fiatNumberFormat(spendUsd)} USD
          </span>
        </div>

        {openInfoKey === 'Spend' && (
          <div className="col-span-2 mt-1 mb-1 info-card text-sm">
            Total order cost in USD to execute this trade. Includes execution notional and
            commission fees, with price impact accounted for.
          </div>
        )}

        {/* Save vs */}

        <div className="col-span-2 flex items-center justify-between py-1.5 transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] sm:text-sm">Save vs</span>

            <span className="relative inline-flex items-center align-baseline">
              <button
                ref={dropdown.triggerRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={dropdown.open}
                disabled={peers.length === 0}
                onClick={() => peers.length > 0 && dropdown.setOpen((v) => !v)}
                className={[
                  'inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0',
                  'text-inherit cursor-pointer focus:outline-none font-semibold',
                  peers.length === 0 ? 'opacity-60 cursor-not-allowed' : '',
                ].join(' ')}
                title={
                  peers.length === 0
                    ? 'Select at least 2 exchanges to compare'
                    : 'Compare against another exchange'
                }
              >
                {compareId ? compareId : 'None'}
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 20 20"
                  className="opacity-80"
                >
                  <path
                    d="M5 7l5 6 5-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {dropdown.open &&
                createPortal(
                  <div
                    ref={dropdown.panelRef}
                    style={{
                      position: 'fixed',
                      left: dropdown.coords.left,
                      top: dropdown.coords.top,
                      width: dropdown.coords.width,
                      zIndex: 60,
                      maxHeight: '50vh',
                      overflowY: 'auto',
                    }}
                    className="dropdown-panel py-1 custom-scrollbar"
                    role="listbox"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      role="option"
                      className={[
                        'dropdown-item px-3 py-1.5 text-sm leading-5',
                        compareId === '' ? 'dropdown-item-active' : '',
                      ].join(' ')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setCompareId('');
                        dropdown.setOpen(false);
                      }}
                    >
                      None
                    </button>
                    {peers.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        className={[
                          'dropdown-item px-3 py-1.5 text-sm leading-5',
                          id === compareId ? 'dropdown-item-active' : '',
                        ].join(' ')}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCompareId(id);
                          dropdown.setOpen(false);
                        }}
                      >
                        {id}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
            </span>

            <InfoDot onClick={() => setOpenInfoKey((k) => (k === 'SaveVs' ? null : 'SaveVs'))} />
          </div>

          <span
            className={[
              'shrink-0 font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis',
              savedUsd == null
                ? 'text-muted'
                : savedUsd > 0
                  ? 'text-emerald-500'
                  : savedUsd < 0
                    ? 'text-rose-500'
                    : 'text-muted',
            ].join(' ')}
          >
            {savedUsd == null ? '—' : `${fiatNumberFormat(savedUsd)} USD`}
          </span>
        </div>
      </dl>

      {openInfoKey === 'SaveVs' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-2">
            <div className="info-card text-sm">
              “Save vs” is the USD difference between this and the chosen exchange. For buys: if
              size is in base we use USD spent; if in quote we take net base received (after fees).
              For sells: if size is in base we use USD received (minus any fee paid in a third
              token); if in quote we take the base effectively spent (including base-equivalent
              fees).
            </div>
          </td>
        </tr>
      )}
    </section>
  );
}
