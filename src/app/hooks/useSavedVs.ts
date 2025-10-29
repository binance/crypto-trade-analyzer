import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { calculateSavings } from '../../utils/utils';
import type { ExchangeId } from '../../exchanges';
import type { CostBreakdown } from '../../core/interfaces/fee-config';

/**
 * Custom React hook for comparing cost breakdowns between exchanges and calculating potential savings.
 *
 * This hook provides logic for selecting a peer exchange to compare against the current exchange,
 * calculates the USD savings between the two exchanges, and manages dropdown UI positioning for the comparison panel.
 *
 * @param params - The parameters for the hook.
 * @param params.exchangeId - The ID of the current exchange.
 * @param params.costBreakdownMap - A mapping of exchange IDs to their respective cost breakdowns.
 * @param params.rankedExchanges - An array of exchange IDs ranked from best to worst based on cost.
 * @param params.paused - Indicates if the comparison is currently paused.
 *
 * @returns An object containing:
 * - `peers`: Sorted array of peer exchange IDs available for comparison.
 * - `compareId`: The currently selected peer exchange ID for comparison.
 * - `setCompareId`: Setter for the `compareId`.
 * - `savedUsd`: The calculated USD savings when comparing the current exchange to the selected peer, or `undefined`.
 * - `dropdown`: UI state and refs for managing the comparison dropdown, including:
 *    - `open`: Whether the dropdown is open.
 *    - `setOpen`: Setter for the dropdown open state.
 *    - `triggerRef`: Ref for the dropdown trigger button.
 *    - `panelRef`: Ref for the dropdown panel.
 *    - `coords`: Positioning coordinates for the dropdown panel.
 *
 * @remarks
 * - The hook automatically resets the comparison if the selected peer is no longer available.
 * - Dropdown positioning is recalculated on scroll, resize, and outside clicks.
 */
export function useSavedVs({
  exchangeId,
  costBreakdownMap,
  rankedExchanges,
  paused,
}: {
  exchangeId: ExchangeId;
  costBreakdownMap: Record<ExchangeId, CostBreakdown | undefined>;
  rankedExchanges: ExchangeId[];
  paused: boolean | undefined;
}) {
  const costBreakdown = costBreakdownMap[exchangeId]!;
  const isBuy = costBreakdown.side === 'buy';
  const base = costBreakdown.baseAsset.toUpperCase();
  const quote = costBreakdown.quoteAsset.toUpperCase();

  const peers = useMemo(() => {
    const haveData = new Set(
      Object.entries(costBreakdownMap)
        .filter(([, v]) => !!v)
        .map(([k]) => k as ExchangeId)
    );
    return rankedExchanges.filter((id) => id !== exchangeId && haveData.has(id));
  }, [rankedExchanges, exchangeId, costBreakdownMap]);

  const [compareId, setCompareIdState] = useState<ExchangeId | ''>('');

  // if user manually picks a peer, we stick to it until it disappears
  // otherwise we auto-default based on rank
  const manualRef = useRef(false);
  const setCompareId = (id: ExchangeId | '') => {
    manualRef.current = true;
    setCompareIdState(id);
  };

  useEffect(() => {
    if (paused) return;

    if (compareId && !peers.includes(compareId as ExchangeId)) {
      manualRef.current = false;
      setCompareIdState('');
    }
  }, [peers, compareId, paused]);

  useEffect(() => {
    if (paused) return;
    if (manualRef.current) return;

    const meIdx = rankedExchanges.indexOf(exchangeId);
    if (meIdx === -1 || rankedExchanges.length === 0) {
      setCompareIdState('');
      return;
    }

    let next: ExchangeId | '' = '';
    if (meIdx === 0) next = rankedExchanges[1] ?? '';
    else next = rankedExchanges[0] ?? '';

    setCompareIdState(next);
  }, [exchangeId, paused, rankedExchanges]);

  const peerBreakdown = compareId ? costBreakdownMap[compareId] : undefined;

  const [savedUsd, setSavedUsd] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (paused) return;

    if (!compareId || !peerBreakdown) {
      setSavedUsd(undefined);
      return;
    }
    const handle = window.setTimeout(() => {
      const savings = calculateSavings(costBreakdown, peerBreakdown, isBuy, base, quote);
      setSavedUsd(savings.usd);
    }, 32);
    return () => window.clearTimeout(handle);
  }, [compareId, peerBreakdown, costBreakdown, base, quote, isBuy, paused]);

  // dropdown positioning
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const position = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const desiredWidth = Math.max(120, r.width);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - desiredWidth));
    setCoords({
      left: Math.round(left),
      top: Math.round(r.bottom + margin),
      width: Math.round(desiredWidth),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const place = () => position();
    place();
    const onScroll = () => place();
    const onResize = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, position]);

  return {
    peers,
    compareId,
    setCompareId,
    savedUsd,
    dropdown: { open, setOpen, triggerRef, panelRef, coords },
  };
}
