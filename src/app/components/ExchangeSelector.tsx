import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import type { ExchangeId } from '../../exchanges';

/**
 * A popover dialog component for selecting exchanges from a list.
 *
 * Displays a list of exchange options, allowing the user to select up to `maxSlots` exchanges.
 * Exchanges can be disabled if the maximum selection is reached or if they are unsupported for the given trading pair.
 * The dialog positions itself relative to the provided anchor button and closes on outside click or ESC key.
 *
 * @param anchorRef - Ref to the button that anchors the popover position.
 * @param variant - Display style, either 'dropdown' (anchored) or 'inline' (static panel).
 * @param tradingPair - The trading pair to check for exchange support.
 * @param selected - Array of currently selected exchange IDs.
 * @param maxSlots - Maximum number of exchanges that can be selected.
 * @param supportedSet - Set of exchange IDs supported for the given trading pair.
 * @param options - List of available exchanges, each with an `id` and `name`.
 * @param onApply - Callback invoked with the new selection when the dialog closes.
 */
export function ExchangeSelector({
  anchorRef,
  variant = 'dropdown',
  tradingPair,
  selected,
  maxSlots,
  supportedSet,
  options,
  onApply,
}: {
  anchorRef?: RefObject<HTMLButtonElement | null> | null;
  variant?: 'dropdown' | 'inline';
  tradingPair: string;
  selected: ExchangeId[];
  maxSlots: number;
  supportedSet: Set<ExchangeId>;
  options: Array<{ id: ExchangeId; name: string }>;
  onApply: (next: ExchangeId[]) => void;
}): JSX.Element {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [localSelected, setLocalSelected] = useState<ExchangeId[]>(selected);
  useEffect(() => setLocalSelected(selected), [selected]);

  const isInline = variant === 'inline';
  const atLimit = localSelected.length >= maxSlots;

  // Alphabetical by display name
  const sortedExchanges = useMemo(
    () =>
      [...options].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [options]
  );

  // --- dropdown (anchored) positioning state ---
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    openUp: boolean;
  } | null>(null);

  const recalcPosition = useCallback(() => {
    if (isInline) return;
    const btn = anchorRef?.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.max(260, r.width);
    const openUp = window.innerHeight - r.bottom < 300;
    const maxLeft = window.innerWidth - width - 8;
    const left = Math.max(8, Math.min(r.left, maxLeft));
    const top = openUp ? r.top : r.bottom + 8;
    setPos({ top, left, width, openUp });
  }, [anchorRef, isInline]);

  useLayoutEffect(() => {
    if (!isInline) recalcPosition();
  }, [recalcPosition, isInline]);

  useEffect(() => {
    if (isInline) return;
    const onResizeOrScroll = () => recalcPosition();
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    return () => {
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
    };
  }, [recalcPosition, isInline]);

  const commitAndClose = useCallback(() => {
    onApply(localSelected);
  }, [localSelected, onApply]);

  // Outside click / ESC => commit
  useEffect(() => {
    if (isInline) return;
    const onDown = (e: MouseEvent) => {
      const inside =
        popRef.current?.contains(e.target as Node) ||
        anchorRef?.current?.contains(e.target as Node);
      if (!inside) commitAndClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') commitAndClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, commitAndClose, isInline]);

  // Toggle with guards
  const toggleLocal = (id: ExchangeId) => {
    setLocalSelected((prev) => {
      const isSelected = prev.includes(id);
      if (isSelected) return prev.filter((x) => x !== id);
      if (prev.length >= maxSlots) return prev;
      return [...prev, id];
    });
  };

  const header = (
    <div className="sticky-panel panel-header px-3 pt-2 pb-2">
      <div className="flex items-center justify-between min-w-0">
        <div
          className={['badge-soft', atLimit ? 'badge-warn' : ''].join(' ')}
          title={atLimit ? 'Maximum number of exchanges selected' : undefined}
        >
          <span className="font-medium">
            Selected {localSelected.length}/{maxSlots}
          </span>
          {atLimit && <span>· Max</span>}
        </div>

        <button type="button" onClick={commitAndClose} className="btn-compact">
          Done
        </button>
      </div>
    </div>
  );

  const list = (
    <div className="relative">
      <div className="py-1 max-h-64 overflow-auto custom-scrollbar divide-y divide-base">
        {sortedExchanges.map((exchange) => {
          const checked = localSelected.includes(exchange.id);
          const supported = tradingPair ? supportedSet.has(exchange.id) : false;

          let disableAdd = false;
          let reason = '';
          if (!checked && localSelected.length >= maxSlots) {
            disableAdd = true;
            reason = 'Max selected reached';
          } else if (!checked && tradingPair && !supported) {
            disableAdd = true;
            reason = `${exchange.name} doesn't support ${tradingPair}`;
          }

          return (
            <label
              key={exchange.id}
              title={disableAdd ? reason : undefined}
              onMouseDown={(e) => {
                if (disableAdd && !checked) e.preventDefault();
              }}
              className={[
                'dropdown-item text-sm',
                checked ? 'dropdown-item-checked' : '',
                disableAdd && !checked ? 'dropdown-item-disabled' : 'cursor-pointer',
              ].join(' ')}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-muted"
                checked={checked}
                disabled={disableAdd}
                onChange={() => toggleLocal(exchange.id)}
                aria-label={exchange.name}
              />
              <span className="font-medium truncate">{exchange.name}</span>

              {!supported && tradingPair && (
                <span className="chip ml-auto text-[11px]">Unsupported</span>
              )}
            </label>
          );
        })}
      </div>

      {/* Scroll shadows */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-3 scroll-shadow-top" />
      <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-3 scroll-shadow-bottom" />
    </div>
  );

  if (isInline) {
    // Inline panel for the bottom sheet (mobile)
    return (
      <div
        ref={popRef}
        role="dialog"
        aria-label="Exchange selector"
        className="panel rounded-xl custom-scrollbar overflow-hidden"
      >
        {header}
        {list}
      </div>
    );
  }

  // Anchored dropdown (desktop)
  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Exchange selector"
      aria-modal="true"
      className="fixed z-40 dropdown-panel custom-scrollbar overflow-hidden"
      style={{
        top: pos ? pos.top : 0,
        left: pos ? pos.left : 0,
        width: pos ? pos.width : 260,
        transform: pos?.openUp ? 'translateY(-100%)' : 'none',
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? 'auto' : 'none',
      }}
    >
      {header}
      {list}
    </div>
  );
}
