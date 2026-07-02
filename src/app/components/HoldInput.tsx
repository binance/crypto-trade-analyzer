import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { InfoDot } from './InfoDot';

/**
 * Numeric input for the perpetual holding period (in hours), with a suffix "h" and an
 * info tooltip explaining how it feeds funding into the exchange comparison. Visual style
 * matches the other controls (`.field .field-sm`) and the tooltip mirrors {@link SizeInput}.
 *
 * @param value - Current holding-period value as a string.
 * @param onChange - Callback to update the value.
 * @param className - Optional additional CSS classes for the root element.
 */
export function HoldInput({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}): JSX.Element {
  const pageContainerRef = document.querySelector('.container-xl') as HTMLElement | null;
  const [tipOpen, setTipOpen] = useState(false);
  const [tipPlace, setTipPlace] = useState<'top' | 'bottom'>('bottom');
  const tipAnchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const positionTip = useCallback(() => {
    const anchor = tipAnchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;

    tip.style.visibility = 'hidden';
    tip.style.left = '0px';
    tip.style.top = '0px';

    requestAnimationFrame(() => {
      const a = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const vvLeft = vv?.offsetLeft ?? 0;
      const vvTop = vv?.offsetTop ?? 0;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;

      const containerRect = pageContainerRef?.getBoundingClientRect();
      const clampLeft = Math.max(vvLeft + 8, (containerRect?.left ?? 8) + vvLeft);
      const clampRight = Math.min(
        vvLeft + vw - 8,
        containerRect ? containerRect.right + vvLeft : vvLeft + vw - 8
      );

      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const roomBelow = vvTop + vh - a.bottom;
      const place: 'top' | 'bottom' = roomBelow >= height + 12 ? 'bottom' : 'top';

      let left = a.left + vvLeft + a.width / 2 - width / 2;
      left = Math.min(Math.max(left, clampLeft), clampRight - width);
      const top = place === 'bottom' ? a.bottom + 8 + vvTop : a.top - 8 - height + vvTop;

      Object.assign(tip.style, {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        visibility: 'visible',
      });
      tip.style.setProperty('--tip-origin', place === 'bottom' ? 'center top' : 'center bottom');
      setTipPlace(place);

      const arrow = tip.querySelector('.tip-arrow') as HTMLElement | null;
      if (arrow) {
        const anchorCenter = a.left + a.width / 2 + vvLeft;
        const arrowLeft = Math.max(10, Math.min(width - 10, anchorCenter - left));
        arrow.style.left = `${Math.round(arrowLeft - 4)}px`;
      }
    });
  }, [pageContainerRef]);

  useEffect(() => {
    if (!tipOpen) return;

    const onScroll = () => positionTip();
    const onResize = () => positionTip();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (tipAnchorRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      setTipOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTipOpen(false);

    positionTip();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);

    const vv = window.visualViewport;
    vv?.addEventListener('resize', positionTip);
    vv?.addEventListener('scroll', positionTip);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', positionTip);
      vv?.removeEventListener('scroll', positionTip);
    };
  }, [positionTip, tipOpen]);

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-sm text-muted whitespace-nowrap">Hold</span>

      <div className="relative inline-block">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/,/g, '');
            if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) onChange(v);
          }}
          placeholder="8"
          aria-label="Holding period in hours"
          className="field field-sm w-20 pr-7 text-right tabular-nums"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted"
        >
          h
        </span>
      </div>

      <span ref={tipAnchorRef} className="inline-flex">
        <InfoDot onClick={() => setTipOpen((v) => !v)} title="About holding period" />
      </span>

      {tipOpen &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-50 tip tip-anim"
            data-place={tipPlace}
            role="tooltip"
            aria-label="Holding period info"
          >
            <span className="tip-arrow" aria-hidden />
            <p>How long you expect to hold the position, in hours.</p>
            <p className="text-muted">
              Perpetual <i>funding</i> is projected over this period and folded into the exchange
              comparison. Each exchange settles funding on its own interval (often 8h, sometimes 4h
              or 1h); longs pay when the rate is positive, shorts receive it.
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
