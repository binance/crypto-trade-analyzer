import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Wraps any element and shows a positioned portal tooltip on hover, without adding any visual
 * chrome to the trigger. Appears instantly on mouseenter (no browser delay), closes on mouseleave
 * or Escape. Auto-places above or below the anchor, clamped to the viewport.
 *
 * @param content - What to show inside the tooltip.
 * @param children - The trigger element to wrap.
 * @param ariaLabel - Accessible label for the tooltip region.
 * @param suppressed - When true, the tip is force-closed and won't open (e.g. while a menu the
 *   trigger controls is open, so the tip doesn't cover it).
 */
export function HoverTip({
  content,
  children,
  ariaLabel,
  suppressed = false,
}: {
  content: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  suppressed?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<'top' | 'bottom'>('bottom');
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const positionTip = useCallback(() => {
    const anchor = anchorRef.current;
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

      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const margin = 8;
      const roomBelow = vvTop + vh - a.bottom;
      const nextPlace: 'top' | 'bottom' = roomBelow >= height + 12 ? 'bottom' : 'top';

      let left = a.left + vvLeft + a.width / 2 - width / 2;
      left = Math.min(Math.max(left, vvLeft + margin), vvLeft + vw - margin - width);
      const top = nextPlace === 'bottom' ? a.bottom + 8 + vvTop : a.top - 8 - height + vvTop;

      Object.assign(tip.style, {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        visibility: 'visible',
      });
      tip.style.setProperty(
        '--tip-origin',
        nextPlace === 'bottom' ? 'center top' : 'center bottom'
      );
      setPlace(nextPlace);

      const arrow = tip.querySelector('.tip-arrow') as HTMLElement | null;
      if (arrow) {
        const center = a.left + a.width / 2 + vvLeft;
        arrow.style.left = `${Math.round(Math.max(10, Math.min(width - 10, center - left)) - 4)}px`;
      }
    });
  }, []);

  // Force-close whenever suppressed (e.g. the trigger's own menu opened).
  useEffect(() => {
    if (suppressed) setOpen(false);
  }, [suppressed]);

  const visible = open && !suppressed;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    positionTip();
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, positionTip]);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>

      {visible &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-50 tip tip-anim pointer-events-none"
            data-place={place}
            role="tooltip"
            aria-label={ariaLabel}
          >
            <span className="tip-arrow" aria-hidden />
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
