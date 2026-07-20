import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoDot } from './InfoDot';

/**
 * An info affordance: a small "i" dot that toggles a positioned tooltip rendered in a portal.
 *
 * The tooltip auto-places above or below the dot depending on available viewport room, clamps
 * horizontally within the page container, closes on outside click / Escape, and reflows on
 * scroll/resize. Content is provided via `children`.
 *
 * Extracted from the order-size input so the same affordance can be reused across controls.
 *
 * @param title - Accessible label / tooltip title for the dot button.
 * @param ariaLabel - Accessible label for the tooltip dialog (defaults to `title`).
 * @param children - Tooltip body content.
 */
export function InfoTip({
  title = 'More info',
  ariaLabel,
  children,
}: {
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}): JSX.Element {
  const pageContainerRef = document.querySelector('.container-xl') as HTMLElement | null;
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

      const containerRect = pageContainerRef?.getBoundingClientRect();
      const clampLeft = Math.max(vvLeft + 8, (containerRect?.left ?? 8) + vvLeft);
      const clampRight = Math.min(
        vvLeft + vw - 8,
        containerRect ? containerRect.right + vvLeft : vvLeft + vw - 8
      );

      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const roomBelow = vvTop + vh - a.bottom;
      const nextPlace: 'top' | 'bottom' = roomBelow >= height + 12 ? 'bottom' : 'top';

      let left = a.left + vvLeft + a.width / 2 - width / 2;
      left = Math.min(Math.max(left, clampLeft), clampRight - width);
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
        const anchorCenter = a.left + a.width / 2 + vvLeft;
        const arrowLeft = Math.max(10, Math.min(width - 10, anchorCenter - left));
        arrow.style.left = `${Math.round(arrowLeft - 4)}px`;
      }
    });
  }, [pageContainerRef]);

  useEffect(() => {
    if (!open) return;

    const onScroll = () => positionTip();
    const onResize = () => positionTip();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);

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
  }, [positionTip, open]);

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <InfoDot onClick={() => setOpen((v) => !v)} title={title} />
      </span>

      {open &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-50 tip tip-anim"
            data-place={place}
            role="tooltip"
            aria-label={ariaLabel ?? title}
          >
            <span className="tip-arrow" aria-hidden />
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
