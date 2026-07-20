import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { buildTickOptions, formatTick } from '../../utils/utils';
import { HoverTip } from './HoverTip';

/**
 * A dropdown for choosing the order book grouping (tick size). Options are powers-of-ten multiples
 * of the auto-computed base tick; `value` is the selected multiplier (1 = Auto).
 *
 * Renders a portal-based dropdown modeled on {@link UserTierSelect}, with keyboard navigation,
 * outside-click close, and auto-positioning/flip.
 *
 * @param baseTick - The auto-computed base tick (shared coarsest bucket), or undefined when no data.
 * @param finestTick - The finest native tick across selected venues; bounds how fine the options go.
 * @param value - The currently selected multiplier.
 * @param onChange - Callback invoked with the newly selected multiplier.
 * @param disabled - Whether the control is disabled (e.g. no order book yet).
 * @param className - Optional additional CSS classes for the container.
 * @param widthClass - Optional CSS class for the button width (default: 'w-32').
 */
export function TickSizeSelect({
  baseTick,
  finestTick,
  value,
  onChange,
  disabled = false,
  className = '',
  widthClass = 'min-w-40',
  tip,
}: {
  baseTick: number | undefined;
  finestTick?: number;
  value: number;
  onChange: (m: number) => void;
  disabled?: boolean;
  className?: string;
  widthClass?: string;
  tip?: ReactNode;
}): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const options = useMemo(
    () =>
      baseTick && baseTick > 0
        ? buildTickOptions(baseTick, finestTick)
        : [{ label: 'Auto', value: 1 }],
    [baseTick, finestTick]
  );

  const idxByValue = useMemo(
    () =>
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      ),
    [options, value]
  );

  // If the selected multiplier is no longer offered (options re-clamped for a new pair/venue set),
  // snap back to Auto so the control never displays a stale selection.
  useEffect(() => {
    if (value !== 1 && !options.some((o) => o.value === value)) onChange(1);
  }, [options, value, onChange]);

  const [coords, setCoords] = useState({ left: 0, top: 0, width: 0 });
  const positionDropdown = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const desiredWidth = Math.max(120, r.width);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - desiredWidth));
    const top = Math.round(r.bottom + margin);
    setCoords({ left: Math.round(left), top, width: Math.round(desiredWidth) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    setReady(false);
    setActiveIdx(idxByValue);
    positionDropdown();
  }, [open, idxByValue, positionDropdown]);

  useEffect(() => {
    if (!open) return;

    const flipIfNeeded = () => {
      const panel = dropdownRef.current;
      const btn = btnRef.current;
      if (!panel || !btn) return;

      const margin = 8;
      const panelRect = panel.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();

      setCoords((c) => {
        const next = { ...c };
        if (panelRect.bottom > window.innerHeight)
          next.top = Math.round(btnRect.top - panelRect.height - margin);

        if (panelRect.width > 0) {
          const maxLeft = window.innerWidth - margin - panelRect.width;
          next.left = Math.round(Math.min(Math.max(margin, c.left), Math.max(margin, maxLeft)));
        }
        return next;
      });
      setReady(true);
    };

    const rafId = requestAnimationFrame(flipIfNeeded);

    const softReposition = () => {
      setReady(false);
      positionDropdown();
      requestAnimationFrame(() => setReady(true));
    };

    window.addEventListener('scroll', softReposition, true);
    window.addEventListener('resize', softReposition);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', softReposition, true);
      window.removeEventListener('resize', softReposition);
    };
  }, [open, positionDropdown]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (btnRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const select = (v: number) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(positionDropdown);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pick = options[activeIdx];
      if (pick) select(pick.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Trigger shows just the resulting tick value (exchange-standard), e.g. "0.0001".
  const triggerValue = baseTick && baseTick > 0 ? formatTick(baseTick * value) : '—';

  const triggerButton = (
    <button
      ref={btnRef}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label="Tick size"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        setOpen((o) => !o);
        requestAnimationFrame(positionDropdown);
      }}
      onKeyDown={onKeyDown}
      className={[
        'inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm transition',
        'focus:outline-none focus-visible:ring-2',
        widthClass,
        'justify-end',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
      ].join(' ')}
      style={{ ['--tw-ring-color' as never]: 'rgb(var(--focus))' }}
    >
      <span className="whitespace-nowrap tabular-nums">{triggerValue}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 opacity-70">
        <path d="M6 8l4 4 4-4" fill="currentColor" />
      </svg>
    </button>
  );

  return (
    <div className={`relative ${className}`}>
      {tip ? (
        <HoverTip content={tip} ariaLabel="Tick size info" suppressed={open}>
          {triggerButton}
        </HoverTip>
      ) : (
        triggerButton
      )}

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              minWidth: coords.width,
              zIndex: 60,
              visibility: ready ? 'visible' : 'hidden',
            }}
            onWheel={(e) => e.stopPropagation()}
            className="dropdown-panel custom-scrollbar"
          >
            {options.map((opt, i) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={opt.label}
                  className={[
                    'dropdown-item justify-between',
                    i === activeIdx ? 'dropdown-item-active' : '',
                    selected ? 'font-medium' : '',
                  ].join(' ')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => select(opt.value)}
                >
                  <span className="whitespace-nowrap">{opt.label}</span>
                  {selected && (
                    <span aria-hidden className="ml-2">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
