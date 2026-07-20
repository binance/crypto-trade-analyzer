import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Gauge } from 'lucide-react';
import type { LatencyStat } from '../hooks/useExchangeEngine';

/**
 * Small inline badge showing the order-book generation-to-receive latency for an exchange: the
 * time between the venue's matching engine producing the order book and our client receiving it,
 * corrected for the venue's clock offset. The headline is the rolling median (p50) with a ±jitter
 * (p95 − p50) suffix so consistency is visible, not just the mean. Highlighted when this exchange
 * currently has the lowest median latency among the compared venues.
 *
 * The explanatory tooltip is rendered through a portal with fixed positioning (like HoldInput),
 * because the exchange card uses `overflow-hidden` which would otherwise clip an in-flow tooltip.
 * It opens on hover / keyboard focus (pointer devices) or tap (touch devices).
 *
 * @param stat - Aggregated latency stat (p50, jitter, clock offset, confidence), or undefined.
 * @param isLowest - Whether this exchange currently has the lowest median latency of those compared.
 * @param loading - When true (and no stat yet), shows a "measuring…" placeholder in the badge's slot.
 */
export function LatencyBadge({
  stat,
  isLowest = false,
  loading = false,
}: {
  stat?: LatencyStat;
  isLowest?: boolean;
  loading?: boolean;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const canHover =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover)').matches;

  const positionTip = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;

    tip.style.visibility = 'hidden';
    tip.style.left = '0px';
    tip.style.top = '0px';

    requestAnimationFrame(() => {
      if (!tipRef.current) return;
      const a = anchor.getBoundingClientRect();
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;

      const roomBelow = vh - a.bottom;
      const place: 'top' | 'bottom' = roomBelow >= height + 12 ? 'bottom' : 'top';

      let left = a.left + a.width / 2 - width / 2;
      left = Math.min(Math.max(left, 8), vw - 8 - width);
      const top = place === 'bottom' ? a.bottom + 8 : a.top - 8 - height;

      Object.assign(tip.style, {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        visibility: 'visible',
      });
      tip.style.setProperty('--tip-origin', place === 'bottom' ? 'center top' : 'center bottom');
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    positionTip();
    const onScroll = () => positionTip();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', positionTip);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', positionTip);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, positionTip]);

  const hasStat = !!stat && Number.isFinite(stat.p50) && stat.p50 >= 0;

  // Before the first real reading: show a quiet "measuring…" placeholder (spinner) if we're
  // actively working toward one, otherwise render nothing.
  if (!hasStat) {
    if (!loading) return null;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[length:inherit] font-medium text-muted ring-1 ring-zinc-300/60 dark:ring-white/10"
        role="status"
        aria-label="Measuring order book latency"
        title="Measuring order book latency…"
      >
        <span className="inline-block h-[1em] w-[1em] rounded-full border-2 ring-spinner animate-spin" />
        <span className="opacity-70">measuring…</span>
      </span>
    );
  }

  const s = stat as LatencyStat;
  const p50 = Math.round(s.p50);
  const jitter = Math.round(s.jitter);
  // Show ±jitter once the window has a few samples. Latency is sampled ~once per second (the book
  // emit throttle), so 5 samples ≈ 5s of data — enough for a meaningful p95-based jitter.
  const showJitter = s.samples >= 5;

  return (
    <>
      <span
        ref={anchorRef}
        tabIndex={0}
        role="button"
        aria-label={`Data freshness ${p50} milliseconds${showJitter ? `, varying by ${jitter}` : ''}${isLowest ? ', freshest of compared exchanges' : ''}`}
        onMouseEnter={() => canHover && setOpen(true)}
        onMouseLeave={() => canHover && setOpen(false)}
        onFocus={() => canHover && setOpen(true)}
        onBlur={() => canHover && setOpen(false)}
        onClick={() => !canHover && setOpen((v) => !v)}
        className={[
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[length:inherit] font-medium tabular-nums cursor-default outline-none',
          'ring-1 focus-visible:ring-2',
          isLowest
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30'
            : 'text-muted ring-zinc-300/60 dark:ring-white/10',
        ].join(' ')}
      >
        <Gauge size="1em" aria-hidden="true" />
        {p50}
        {showJitter && <span className="opacity-70">±{jitter}</span>}
        <span className="opacity-70">ms</span>
      </span>

      {open &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-50 tip tip-anim"
            role="tooltip"
            style={{ maxWidth: 240 }}
          >
            <p>
              <b>Data freshness</b>
            </p>
            <p className="text-muted">
              How quickly this exchange’s live order book reaches you — about <b>{p50}ms</b>
              {showJitter ? <>, varying by ±{jitter}ms</> : null}.{' '}
              {isLowest ? 'Freshest of the exchanges shown. ' : ''}Lower and steadier is better.
            </p>
            <p className="text-muted">Use it to compare exchanges against each other.</p>
          </div>,
          document.body
        )}
    </>
  );
}
