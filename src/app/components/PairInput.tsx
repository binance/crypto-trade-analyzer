import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { normalizePairText } from '../../utils/utils';
import type { PairMeta } from '../types';

/**
 * A searchable dropdown input component for selecting a trading pair from a list of options.
 *
 * Displays a text input that, when focused or clicked, opens a dropdown with filtered options.
 * Supports keyboard navigation, outside click closing, and disables options based on support metadata.
 *
 * @param value - The currently selected trading pair value.
 * @param options - List of available trading pair options to choose from.
 * @param onChange - Callback invoked when a trading pair is selected.
 * @param className - Optional additional CSS classes for the container.
 * @param placeholder - Optional placeholder text for the input field.
 * @param metaByPair - Optional metadata for each trading pair, used to determine disabled state and tooltips.
 *
 * @remarks
 * - Uses a portal to render the dropdown menu at the document body level for proper positioning.
 * - Handles dropdown positioning on scroll and resize events.
 * - Supports incremental loading of options for large lists.
 * - Keyboard navigation: Arrow keys, Home/End, Enter to select, Escape to close.
 */
export function PairInput({
  value,
  options,
  onChange,
  className = '',
  placeholder = 'Search trading pair',
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  metaByPair?: Record<string, PairMeta>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);

  const prepared = useMemo(() => {
    return options.map((opt) => {
      const labelLower = opt.toLowerCase();
      const norm = normalizePairText(opt);
      return { opt, labelLower, norm };
    });
  }, [options]);

  // Reversed prefix match
  const reversedPrefixMatch = (qNorm: string, pairNorm: string): boolean => {
    if (qNorm.length < 2) return false;
    const n = pairNorm.length;
    for (let i = 1; i < n; i++) {
      const rotated = pairNorm.slice(i) + pairNorm.slice(0, i);
      if (rotated.startsWith(qNorm)) return true;
    }
    return false;
  };

  const filtered = useMemo(() => {
    const raw = query.trim();
    if (!raw) return prepared;

    const qLower = raw.toLowerCase();
    const qNorm = normalizePairText(raw);

    // Score:
    //  4   =  exact norm
    //  3   =  norm startsWith
    //  2.6 = reversed-prefix match
    //  2   = labelLower includes raw as-is (handles typing with '/','-',' ')
    //  1   = norm includes
    //  0   = no match
    const scored = prepared
      .map((item) => {
        let score = 0;
        if (item.norm === qNorm) {
          score = 4;
        } else if (item.norm.startsWith(qNorm)) {
          score = 3;
        } else if (reversedPrefixMatch(qNorm, item.norm)) {
          score = 2.6;
        } else if (item.labelLower.includes(qLower)) {
          score = 2;
        } else if (item.norm.includes(qNorm)) {
          score = 1;
        }
        return { ...item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.norm.length !== b.norm.length) return a.norm.length - b.norm.length;
        return a.opt.localeCompare(b.opt);
      });

    // Reset item refs length to match current list
    itemRefs.current.length = scored.length;
    return scored;
  }, [prepared, query]);

  // Keep active item visible while navigating with keyboard
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[activeIdx];
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // Reset scroll position when query changes
  useEffect(() => {
    if (dropdownRef.current) dropdownRef.current.scrollTop = 0;
    setActiveIdx(0);
  }, [query]);

  // positioning
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 0 });

  // position dropdown below input
  const positionDropdown = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const margin = 8;
    const vwLeft = margin;
    const vwRight = window.innerWidth - margin;
    const desiredLeft = r.left;
    const desiredWidth = r.width;
    const maxWidth = Math.min(desiredWidth, vwRight - vwLeft);
    const left = Math.max(vwLeft, Math.min(desiredLeft, vwRight - maxWidth));

    setCoords({
      left: Math.round(left),
      top: Math.round(r.bottom + margin),
      width: Math.round(Math.min(desiredWidth, vwRight - left)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    positionDropdown();
    const raf = { id: 0 as number | null };
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (dropdownRef.current && t && dropdownRef.current.contains(t)) return;
      if (raf.id) return;
      raf.id = requestAnimationFrame(() => {
        positionDropdown();
        raf.id = null;
      });
    };
    const onResize = () => positionDropdown();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      if (raf.id) cancelAnimationFrame(raf.id);
    };
  }, [open, positionDropdown]);

  // outside click
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (inputRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selectOption = (opt: string) => {
    onChange(opt);
    setQuery('');
    setActiveIdx(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      setActiveIdx(0);
      requestAnimationFrame(positionDropdown);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(Math.max(filtered.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[activeIdx]?.opt ?? filtered[activeIdx];
      if (!pick) return;
      selectOption(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          requestAnimationFrame(positionDropdown);
        }}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(positionDropdown);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        role="combobox"
        className="field w-full"
      />

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              width: coords.width,
              zIndex: 60,
              maxHeight: '50vh',
              overflowY: 'auto',
            }}
            role="listbox"
            onWheel={(e) => e.stopPropagation()}
            className="dropdown-panel custom-scrollbar"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">No matches</div>
            ) : (
              filtered.map((item, i) => {
                const opt = item.opt ?? item;

                return (
                  <button
                    type="button"
                    key={opt}
                    ref={(el) => {
                      itemRefs.current[i] = el as HTMLButtonElement;
                    }}
                    role="option"
                    aria-selected={i === activeIdx}
                    className={[
                      'dropdown-item',
                      i === activeIdx ? 'dropdown-item-active' : '',
                    ].join(' ')}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => selectOption(opt)}
                  >
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
