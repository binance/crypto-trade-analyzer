import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { cryptoNumberFormat, percentageNumberFormat } from '../../utils/utils';
import { useScrollHost } from '../hooks/useScrollHost';
import { Spacer } from './Spacer';
import type { CostBreakdown } from '../../core/interfaces/fee-config';

/**
 * Displays detailed commission fee information, including the paid amount and the effective taker fee.
 * Provides an interactive popover to show a breakdown of the fee calculation steps.
 *
 * @param costBreakdown - An object containing details about the trading fee, asset, and fee rate analysis history.
 * @returns A JSX element rendering the commission fee details and an optional breakdown popover.
 */
export function CommissionFeesDetails({
  costBreakdown,
}: {
  costBreakdown: CostBreakdown;
}): JSX.Element {
  // State for popover visibility and position
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [neededSpacer, setNeededSpacer] = useState(0);

  // Refs for trigger button and popover element
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const hostEl = useScrollHost(triggerRef.current);

  const history = costBreakdown.feeRateAnalysis ?? [];
  const finalRate = costBreakdown.tradingFee.rate!;

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

    const margin = 8;
    const gap = 8;
    let rafId = 0;

    const place = () => {
      const trigRect = triggerRef.current!.getBoundingClientRect();
      const popEl = popRef.current;

      const measuredWidth = popEl?.offsetWidth ?? 280;
      const measuredHeight = popEl?.offsetHeight ?? 0;

      // right-align & clamp
      let left = trigRect.right - measuredWidth;
      const maxLeft = window.innerWidth - measuredWidth - margin;
      const minLeft = margin;
      left = Math.min(Math.max(left, minLeft), maxLeft);

      const top = trigRect.bottom + gap;
      setPos({ top, left });

      if (measuredHeight) {
        const desiredBottom = top + measuredHeight + margin;
        const overflow = desiredBottom - window.innerHeight;
        setNeededSpacer(Math.max(overflow, 0));
      }
    };

    const onScrollOrResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(place);
    };

    // initial
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

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800">
      <dl className="grid grid-cols-[minmax(0,1fr)_max-content] gap-x-4 gap-y-3 items-center">
        {/* Pay */}
        <dt className="text-sm text-zinc-600 dark:text-zinc-400">Pay</dt>
        <dd className="text-right">
          <span className="font-mono text-sm tabular-nums font-medium">
            {cryptoNumberFormat(costBreakdown.tradingFee.amount, { maxDecimals: 8 })}{' '}
            <span>{costBreakdown.tradingFee.asset}</span>
          </span>
        </dd>

        {/* Effective taker fee */}
        <dt className="text-sm text-zinc-600 dark:text-zinc-400">Effective Taker Fee</dt>
        <dd className="text-right">
          <div className="flex items-center justify-end">
            <button
              ref={triggerRef}
              onClick={() => setOpen((v) => !v)}
              aria-label="Show fee breakdown"
              aria-expanded={open}
              aria-controls="fee-breakdown-popover"
              className={[
                'font-mono text-sm tabular-nums font-medium',
                'underline decoration-dotted underline-offset-[3px] decoration-[1.25px]',
                'decoration-zinc-600/60 dark:decoration-zinc-300/60',
                'hover:decoration-zinc-700/85 dark:hover:decoration-zinc-200/85',
                'text-zinc-900 dark:text-zinc-100 bg-transparent p-0 m-0 border-0',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 rounded-sm',
                'relative after:absolute after:-inset-x-1 after:-inset-y-1 after:content-[""]',
              ].join(' ')}
            >
              {percentageNumberFormat(finalRate)}
            </button>
          </div>
        </dd>
      </dl>

      {/* Portal popover */}
      {open &&
        createPortal(
          <div
            ref={popRef}
            id="fee-breakdown-popover"
            role="dialog"
            style={
              pos
                ? { position: 'fixed', top: pos.top, left: pos.left }
                : { position: 'fixed', visibility: 'hidden' }
            }
            className="z-50 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 p-3 min-w-[220px]"
          >
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Calculation
              </span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Taker fee
              </span>
            </div>
            <div className="mt-1.5 mb-2 border-t border-zinc-200/70 dark:border-white/10" />

            <div className="space-y-1.5">
              {[...history, { id: 'Final', rate: finalRate }].map((step, i, arr) => {
                const isFinal = i === arr.length - 1;
                return (
                  <div
                    key={`${step.id}-${i}`}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span
                      className={
                        isFinal
                          ? 'truncate font-semibold text-zinc-900 dark:text-zinc-100'
                          : 'truncate text-zinc-900 dark:text-zinc-100'
                      }
                    >
                      {step.id}
                    </span>
                    <span
                      className={
                        isFinal
                          ? 'soft-divider font-mono tabular-nums flex-shrink-0 font-semibold text-zinc-900 dark:text-zinc-100'
                          : 'font-mono tabular-nums flex-shrink-0 text-zinc-900 dark:text-zinc-100'
                      }
                    >
                      {percentageNumberFormat(step.rate)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )}

      <Spacer host={hostEl} height={neededSpacer} />
    </div>
  );
}
