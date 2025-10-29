import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A custom dropdown select component for choosing a user tier.
 *
 * Renders a button that, when clicked, displays a dropdown list of options.
 * Supports keyboard navigation, accessibility features, and custom label formatting.
 * The dropdown is rendered via a portal to `document.body` for proper positioning.
 *
 * @param value - The currently selected value.
 * @param options - Array of selectable string options.
 * @param onChange - Callback invoked when a new option is selected.
 * @param className - Optional additional CSS classes for the container.
 * @param widthClass - Optional CSS class for the button width (default: 'w-36').
 * @param labelFormatter - Optional function to format the display label for the selected value.
 *
 * @returns A React component for selecting a user tier.
 */
export function UserTierSelect({
  value,
  options,
  onChange,
  className = '',
  widthClass = 'w-36',
  labelFormatter,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  className?: string;
  widthClass?: string;
  labelFormatter?: (v: string) => string;
}): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const idxByValue = useMemo(
    () =>
      Math.max(
        0,
        options.findIndex((o) => o === value)
      ),
    [options, value]
  );

  // position
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

      const panelRect = panel.getBoundingClientRect();
      if (panelRect.bottom > window.innerHeight) {
        const btnRect = btn.getBoundingClientRect();
        const margin = 8;
        setCoords((c) => ({ ...c, top: Math.round(btnRect.top - panelRect.height - margin) }));
      }
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

  const select = (v: string) => {
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
      if (pick) select(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const label = labelFormatter ? labelFormatter(value) : value;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(positionDropdown);
        }}
        onKeyDown={onKeyDown}
        className={`field field-sm ${widthClass} flex items-center justify-between`}
      >
        <span className="truncate">{label}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="ml-2 h-4 w-4 opacity-70">
          <path d="M6 8l4 4 4-4" fill="currentColor" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              width: coords.width,
              zIndex: 60,
              visibility: ready ? 'visible' : 'hidden',
            }}
            onWheel={(e) => e.stopPropagation()}
            className="dropdown-panel custom-scrollbar"
          >
            {options.map((opt, i) => {
              const selected = opt === value;
              return (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={opt}
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
                  onClick={() => select(opt)}
                >
                  <span className="truncate">{opt}</span>
                  {selected && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
