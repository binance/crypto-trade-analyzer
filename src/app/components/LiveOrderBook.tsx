import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { LiveOrderBookRow } from './LiveOrderBookRow';
import { cryptoNumberFormat } from '../../utils/utils';
import type { OrderBook, OrderBookEntry } from '../../core/interfaces/order-book';
import { createPortal } from 'react-dom';
import { useScrollHost } from '../hooks/useScrollHost';
import { Spacer } from './Spacer';

/**
 * Finds the nearest scrollable parent element of a given HTML element.
 *
 * @param node - The HTML element to find the scrollable parent for, or null
 * @returns The nearest parent element with scroll overflow (auto or scroll), or the window object if no scrollable parent is found
 *
 * @example
 * ```typescript
 * const element = document.getElementById('myElement');
 * const scrollParent = getScrollParent(element);
 * // scrollParent will be either a scrollable parent element or window
 * ```
 */
function getScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let p: HTMLElement | null = node?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (/(auto|scroll)/.test(oy)) return p;
    p = p.parentElement;
  }
  return window;
}

/**
 * Displays a header label with an interactive popover explaining the "Total" column in an order book.
 *
 * The popover provides details about how the cumulative total is calculated for bids and asks,
 * and describes how the background depth bars are scaled. The popover is positioned relative to
 * the trigger button and automatically adjusts its position to avoid viewport overflow.
 *
 * @param label - The text label to display in the header.
 * @param base - (Optional) The base asset symbol to display in the popover explanation.
 *
 * @remarks
 * - Clicking the label toggles the popover.
 * - The popover closes when clicking outside or when the component unmounts.
 * - The popover uses a portal to render at the document body level.
 */
function TotalHeaderInfo({ label, base }: { label: string; base?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [neededSpacer, setNeededSpacer] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const didNudgeRef = useRef(false);

  const hostEl = useScrollHost(triggerRef.current);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Position popover
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    didNudgeRef.current = false;
    let rafId = 0;

    const place = () => {
      const margin = 8;
      const gap = 8;
      const trigRect = triggerRef.current!.getBoundingClientRect();
      const popEl = popRef.current;

      const w = popEl?.offsetWidth ?? 280;
      const h = popEl?.offsetHeight ?? 0;

      let left = trigRect.right - w;
      const maxLeft = window.innerWidth - w - margin;
      const minLeft = margin;
      left = Math.min(Math.max(left, minLeft), maxLeft);

      const top = trigRect.bottom + gap;
      setPos({ top, left });

      if (h && !didNudgeRef.current) {
        const desiredBottom = top + h + margin;
        const overflow = desiredBottom - window.innerHeight;
        setNeededSpacer(Math.max(overflow, 0));
      }
    };

    const onScrollOrResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(place);
    };

    place();

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    const ro = new ResizeObserver(() => onScrollOrResize());
    if (popRef.current) ro.observe(popRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      ro.disconnect();
      setNeededSpacer(0);
    };
  }, [open]);

  // Auto-nudge after spacer appears (smooth scroll)
  useEffect(() => {
    if (!open || neededSpacer <= 0 || didNudgeRef.current === true) return;
    const sp = getScrollParent(triggerRef.current);
    if (sp === window) window.scrollBy({ top: neededSpacer, behavior: 'smooth' });
    else (sp as HTMLElement).scrollBy({ top: neededSpacer, behavior: 'smooth' });
    didNudgeRef.current = true;
  }, [open, neededSpacer]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="total-col-popover"
        className={[
          'inline-flex items-center gap-1 text-right',
          'underline decoration-dotted underline-offset-[3px] decoration-[1.25px]',
          'decoration-zinc-500/60 dark:decoration-zinc-300/60',
          'hover:decoration-zinc-700/85 dark:hover:decoration-zinc-200/85',
          'focus:outline-none focus-visible:ring-2 rounded-sm',
        ].join(' ')}
        style={{ ['--tw-ring-color' as never]: 'rgb(var(--focus))' }}
        title="What is Total?"
      >
        {label}
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            id="total-col-popover"
            role="dialog"
            style={
              pos
                ? { position: 'fixed', top: pos.top, left: pos.left }
                : { position: 'fixed', visibility: 'hidden' }
            }
            className="z-50 tip tip-anim p-3 min-w-[260px]"
          >
            <div className="text-sm leading-snug space-y-2">
              <p>
                <strong>Total</strong> is the running sum of the{' '}
                {base ? base.toUpperCase() : 'base'} amount up to this row.
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <span className="font-medium">Bids:</span> adds all amounts from the highest bid
                  down to this price.
                </li>
                <li>
                  <span className="font-medium">Asks:</span> adds all amounts from the lowest ask up
                  to this price.
                </li>
              </ul>
              <p className="text-[12px] text-muted">
                The background bars use this running total. A fuller bar = more available at (or
                better than) this price on that side.
              </p>
            </div>
          </div>,
          document.body
        )}

      <Spacer host={hostEl} height={neededSpacer} />
    </>
  );
}

/**
 * Renders a live order book table displaying bids and asks for a trading pair.
 *
 * @param book - The current order book data containing bids and asks.
 * @param idx - Array of indices specifying which order book levels to display.
 * @param base - The base asset symbol (optional).
 * @param quote - The quote asset symbol (optional).
 * @param precision - Number of decimal places to display for prices (optional).
 * @param waitingForLiveOrderBook - Indicates if the order book is loading or waiting for data.
 * @returns JSX.Element representing the order book table with cumulative amounts and depth visualization.
 *
 * @remarks
 * - Bids are displayed best-to-worst (top-to-bottom).
 * - Asks are displayed worst-to-best (top-to-bottom), reversing the natural order.
 * - Cumulative amounts are calculated for both sides and used for depth visualization.
 * - Table headers and formatting are dynamically generated based on provided asset symbols and precision.
 */
export function LiveOrderBook({
  book,
  idx,
  base,
  quote,
  precision,
  waitingForLiveOrderBook,
}: {
  book: OrderBook | undefined;
  idx: number[];
  base?: string;
  quote?: string;
  precision?: number;
  waitingForLiveOrderBook: boolean;
}): JSX.Element {
  const hasBook = !!book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0);

  const fullBids: OrderBookEntry[] = book?.bids ?? [];
  const fullAsks: OrderBookEntry[] = book?.asks ?? [];
  const visIdx = [...idx].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b);

  // Visible slices
  const visBids = visIdx.map((i) => fullBids[i]).filter(Boolean) as OrderBookEntry[];
  const visAsksBestFirst = visIdx.map((i) => fullAsks[i]).filter(Boolean) as OrderBookEntry[];
  const visAsks = visAsksBestFirst.slice().reverse();

  // Bids: best -> worse, cumulative from top down
  const bidCumAmt: number[] = [];
  {
    let acc = 0;
    for (let i = 0; i < visBids.length; i++) {
      acc += visBids[i].quantity;
      bidCumAmt[i] = acc;
    }
  }

  // Asks: worst -> best, cumulative from bottom (best) upward
  const askCumAmt: number[] = new Array(visAsks.length);
  {
    let acc = 0;
    for (let i = visAsks.length - 1; i >= 0; i--) {
      acc += visAsks[i].quantity;
      askCumAmt[i] = acc;
    }
  }

  const bidCumMax = Math.max(bidCumAmt[bidCumAmt.length - 1] ?? 0, Number.EPSILON);
  const askCumMax = Math.max(askCumAmt[0] ?? 0, Number.EPSILON);

  // Headers
  const priceHdr = `Price${quote ? ` (${quote.toUpperCase()})` : ''}`;
  const amountHdr = `Amount${base ? ` (${base.toUpperCase()})` : ''}`;
  const totalHdr = `Total${base ? ` (${base.toUpperCase()})` : ''}`;

  const priceDecimals = Math.max(0, precision ?? 2);

  return (
    <div className="px-4 pb-3 text-sm min-w-0 overflow-x-auto">
      <table className="w-full table-fixed text-sm text-strong border-separate border-spacing-y-1">
        <colgroup>
          <col className="w-auto" />
          <col className="w-[12ch]" />
          <col className="w-[12ch]" />
        </colgroup>

        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left pb-2 px-1">{priceHdr}</th>
            <th className="text-right pb-2 pr-2">{amountHdr}</th>
            <th className="text-right pb-2">
              <TotalHeaderInfo label={totalHdr} base={base} />
            </th>
          </tr>
        </thead>

        <tbody>
          {/* Ask */}
          {!waitingForLiveOrderBook && visAsks.length > 0 && (
            <tr aria-hidden="true">
              <td colSpan={3} className="px-1 pt-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                  <span className="shrink-0">Ask</span>
                </div>
              </td>
            </tr>
          )}

          {visAsks.map((level, i) => {
            if (waitingForLiveOrderBook || !hasBook) return null;
            const cumAmt = askCumAmt[i]; // cumulative base
            const depthPct = (cumAmt / askCumMax) * 100; // normalize to side max
            return (
              <LiveOrderBookRow
                key={`ask-${i}`}
                side="ask"
                priceText={cryptoNumberFormat(level.price, {
                  minDecimals: priceDecimals,
                  maxDecimals: priceDecimals,
                })}
                sizeText={cryptoNumberFormat(level.quantity, { compact: true })}
                totalText={cryptoNumberFormat(cumAmt, { compact: true })}
                depthPct={depthPct}
              />
            );
          })}

          {/* Bid */}
          {!waitingForLiveOrderBook && visBids.length > 0 && (
            <tr aria-hidden="true">
              <td colSpan={3} className="px-1 pt-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                  <span className="shrink-0">Bid</span>
                </div>
              </td>
            </tr>
          )}

          {visBids.map((level, i) => {
            if (waitingForLiveOrderBook || !hasBook) return null;
            const cumAmt = bidCumAmt[i]; // cumulative base
            const depthPct = (cumAmt / bidCumMax) * 100; // normalize to side max
            return (
              <LiveOrderBookRow
                key={`bid-${i}`}
                side="bid"
                priceText={cryptoNumberFormat(level.price, {
                  minDecimals: priceDecimals,
                  maxDecimals: priceDecimals,
                })}
                sizeText={cryptoNumberFormat(level.quantity, { compact: true })}
                totalText={cryptoNumberFormat(cumAmt, { compact: true })}
                depthPct={depthPct}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
