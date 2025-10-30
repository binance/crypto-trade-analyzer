import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { InfoDot } from './InfoDot';
import type { OrderSizeAsset } from '../../core/interfaces/order-book';

/**
 * Shortens a symbol string to a specified maximum length by truncating the middle
 * and replacing it with an ellipsis (`…`). If the symbol's length is less than or equal
 * to the maximum, it is returned unchanged.
 *
 * @param symbol - The symbol string to shorten.
 * @param max - The maximum allowed length of the returned string (default is 14).
 * @returns The shortened symbol string with an ellipsis in the middle if necessary.
 */
function shortenSymbol(symbol: string, max = 14) {
  if (!symbol || symbol.length <= max) return symbol;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${symbol.slice(0, head)}…${symbol.slice(-tail)}`;
}

/**
 * Renders an input component for specifying the order size, with support for selecting the asset (base or quote)
 * and displaying contextual information via a popover.
 *
 * @param sizeStr - The current value of the order size input as a string.
 * @param baseAsset - The symbol of the base asset (e.g., "BTC").
 * @param quoteAsset - The symbol of the quote asset (e.g., "USD").
 * @param sizeAsset - The asset type for the order size ('base' or 'quote'). Defaults to 'base'.
 * @param setSizeStr - Callback to update the order size input value.
 * @param onSizeAssetChange - Callback invoked when the size asset selection changes.
 * @param className - Optional additional CSS classes for the root element.
 * @returns JSX.Element representing the order size input with asset selection and info popover.
 */
export function SizeInput({
  sizeStr,
  baseAsset,
  quoteAsset,
  sizeAsset = 'base',
  setSizeStr,
  onSizeAssetChange,
  className = '',
}: {
  sizeStr: string;
  baseAsset: string | null;
  quoteAsset?: string | null;
  sizeAsset?: OrderSizeAsset;
  setSizeStr: (v: string) => void;
  onSizeAssetChange: (v: OrderSizeAsset) => void;
  className?: string;
}): JSX.Element {
  const base = (baseAsset ?? '').trim();
  const quote = (quoteAsset ?? '').trim();
  const haveAssets = base.length > 0 && quote.length > 0;

  // asset dropdown state
  const [assetOpen, setAssetOpen] = useState(false);
  const [padRight, setPadRight] = useState<number>(72);

  const inputRootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shelfRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // info tip state
  const pageContainerRef = document.querySelector('.container-xl') as HTMLElement | null;
  const [tipOpen, setTipOpen] = useState(false);
  const [tipPlace, setTipPlace] = useState<'top' | 'bottom'>('bottom');
  const tipAnchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!haveAssets) return;
    const el = shelfRef.current;
    if (!el) return;

    const measure = () => {
      const w = Math.ceil(el.getBoundingClientRect().width);
      setPadRight(w + 14);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [haveAssets, base, quote, sizeAsset]);

  // position info tip below/above anchor
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

      // arrow centered under the dot, clamped within the tip box
      const arrow = tip.querySelector('.tip-arrow') as HTMLElement | null;
      if (arrow) {
        const anchorCenter = a.left + a.width / 2 + vvLeft;
        const arrowLeft = Math.max(10, Math.min(width - 10, anchorCenter - left));
        arrow.style.left = `${Math.round(arrowLeft - 4)}px`;
      }
    });
  }, [pageContainerRef]);

  // position + handlers for info tip
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

  // asset dropdown positioning
  useEffect(() => {
    if (!assetOpen) return;

    const placeAsset = () => {
      if (!shelfRef.current || !panelRef.current) return;
      const rect = shelfRef.current.getBoundingClientRect();
      const vv = window.visualViewport;
      const vvLeft = vv?.offsetLeft ?? 0;
      const vvTop = vv?.offsetTop ?? 0;
      const width = Math.max(128, Math.round(rect.width));

      let left = Math.round(rect.left + vvLeft);
      const maxLeft = (vv?.width ?? window.innerWidth) + vvLeft - width - 8;
      left = Math.min(Math.max(left, vvLeft + 8), maxLeft);

      const top = Math.round(rect.bottom + 6 + vvTop);

      Object.assign(panelRef.current.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
      });
    };

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setAssetOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAssetOpen(false);

    placeAsset();

    window.addEventListener('scroll', placeAsset, true);
    window.addEventListener('resize', placeAsset);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);

    const vv = window.visualViewport;
    vv?.addEventListener('resize', placeAsset);
    vv?.addEventListener('scroll', placeAsset);

    return () => {
      window.removeEventListener('scroll', placeAsset, true);
      window.removeEventListener('resize', placeAsset);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', placeAsset);
      vv?.removeEventListener('scroll', placeAsset);
    };
  }, [assetOpen]);

  const assetLabel = sizeAsset === 'base' ? base : quote;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {/* input + inline asset dropdown */}
      <div ref={inputRootRef} className="relative inline-block">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={sizeStr}
          onChange={(e) => {
            const v = e.target.value.replace(/,/g, '');
            if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) setSizeStr(v);
          }}
          placeholder="Order size"
          aria-label="Order size"
          className="field field-sm w-32 min-w-[9rem] sm:w-40 sm:min-w-[12rem] pr-3"
          style={haveAssets ? { paddingRight: `${padRight}px` } : undefined}
        />

        {/* right fade to soften number near the suffix; purely visual */}
        {haveAssets && (
          <div
            aria-hidden
            className="
              pointer-events-none absolute top-1/2 -translate-y-1/2
              right-[calc(var(--fade-w,48px)+8px)]
              h-6 w-15
              bg-gradient-to-l from-background to-transparent
              rounded-sm
            "
            style={{ '--fade-w': '48px' } as React.CSSProperties}
          />
        )}

        {/* suffix shelf */}
        {haveAssets && (
          <button
            ref={shelfRef}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAssetOpen((v) => !v);
              inputRef.current?.focus();
            }}
            aria-haspopup="listbox"
            aria-expanded={assetOpen}
            title={assetLabel}
            className="
              absolute right-2 top-1/2 -translate-y-1/2
              flex items-center gap-2 pl-2 pr-1 py-0.5
              text-sm text-strong/90 bg-transparent
              focus:outline-none
              max-w-[50%] truncate
            "
          >
            <span className="h-4 w-px bg-border/60" aria-hidden />
            <span className="block truncate">{shortenSymbol(assetLabel, 14)}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 20 20"
              aria-hidden="true"
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
            <span className="sr-only">Choose size asset</span>
          </button>
        )}

        {/* Dropdown panel */}
        {assetOpen &&
          haveAssets &&
          createPortal(
            <div
              ref={panelRef}
              className="fixed z-50 dropdown-panel py-0.5"
              role="listbox"
              aria-label="Order size asset options"
            >
              {(['base', 'quote'] as const).map((opt) => {
                const label = opt === 'base' ? base : quote;
                const selected = sizeAsset === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={[
                      'dropdown-item',
                      'px-2 py-1 text-sm leading-5',
                      selected ? 'dropdown-item-active' : '',
                    ].join(' ')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSizeAssetChange(opt);
                      setAssetOpen(false);
                    }}
                    title={label}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}
      </div>

      {/* Info dot + tooltip */}
      <span ref={tipAnchorRef} className="inline-flex">
        <InfoDot onClick={() => setTipOpen((v) => !v)} title="About order size" />
      </span>

      {tipOpen &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-50 tip tip-anim"
            data-place={tipPlace}
            role="tooltip"
            aria-label="Order size info"
          >
            <span className="tip-arrow" aria-hidden />
            <p>Size is simulated against the current order-book liquidity.</p>
            <p className="text-muted">
              Exchange filters such as <i>min notional</i>, <i>step size</i>, and
              <i> price bands/guards</i> are <b>not enforced</b> here.
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
