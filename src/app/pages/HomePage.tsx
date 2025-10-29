import { lazy, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { PairDirectory } from '../../core/services/pair-directory';
import { useExchangeCatalog } from '../hooks/useExchangeCatalog';
import { useExchangeSettings } from '../hooks/useExchangeSettings';
import { usePairOptions } from '../hooks/usePairOptions';
import { useSupportedExchanges } from '../hooks/useSupportedExchanges';
import { useExchangeEngine } from '../hooks/useExchangeEngine';
import { useTermsConsent } from '../hooks/useTermsConsent';
import { MAX_CARD_SLOTS } from '../../utils/constants';
import { countDecimals, parsePair } from '../../utils/utils';
import { syncGAConsent } from '../../utils/analytics';
import type { ExchangeId } from '../../exchanges';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { OrderSide } from '../../core/interfaces/order-book';

import { Pill } from '../components/Pill';
import { PairInput } from '../components/PairInput';
import { SegmentToggle } from '../components/SegmentToggle';
import { SizeInput } from '../components/SizeInput';
import { DropdownButton } from '../components/DropdownButton';
import { ExchangeSelector } from '../components/ExchangeSelector';
import { PauseButton } from '../components/PauseButton';
import { ExchangeCard } from '../components/ExchangeCard';
import { ThemeToggle } from '../components/ThemeToggle';
import { CookieConsentBox } from '../components/CookieConsentBox';

import icon from '/icon.svg?url';
import favicon from '/favicon.png?url';

const TermsModal = lazy(() => import('../components/TermsModal'));

/**
 * Renders a modal bottom sheet component using a React portal.
 *
 * The bottom sheet appears fixed at the bottom of the viewport and overlays the rest of the page.
 * It supports closing via the Escape key or clicking on the backdrop.
 *
 * @param open - Controls whether the bottom sheet is visible.
 * @param onClose - Callback invoked when the bottom sheet should be closed (e.g., Escape key or backdrop click).
 * @param title - Optional title displayed at the top of the bottom sheet.
 * @param children - Content to be rendered inside the bottom sheet.
 *
 * @returns A React portal containing the bottom sheet UI, or `null` if not open.
 */
function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="
          absolute inset-x-0 bottom-0
          max-h-[80vh] overflow-auto
          rounded-t-2xl
          bg-white dark:bg-zinc-900
          ring-1 ring-zinc-200 dark:ring-white/10
          shadow-2xl
          p-4
          pb-[max(env(safe-area-inset-bottom),1rem)]
        "
      >
        <div className="mx-auto h-1 w-10 rounded bg-zinc-300 dark:bg-zinc-700 mb-3" />
        {title && <div className="mb-2 text-sm text-muted">{title}</div>}
        {children}
      </div>
    </div>,
    document.body
  );
}

/**
 * Main application component that renders the crypto trade analyzer interface.
 *
 * This component provides a comprehensive trading comparison tool that:
 * - Allows users to select a trading pair and order size
 * - Compares real-time pricing and fees across multiple cryptocurrency exchanges
 * - Displays cost breakdowns and identifies the most cost-efficient exchange
 * - Supports both buy and sell market orders on spot markets
 * - Provides responsive layouts for desktop and mobile devices
 *
 * @returns The rendered main application interface
 */
function MainApp() {
  // Sync GA consent on mount
  useEffect(() => {
    syncGAConsent();
  }, []);

  const [side, setSide] = useState<OrderSide>('buy');
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  const [sizeStr, setSizeStr] = useState('1');
  const [slots, setSlots] = useState<(ExchangeId | null)[]>([null, null, null, null]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sizeAsset, setSizeAsset] = useState<'base' | 'quote'>('base');
  const [stuck, setStuck] = useState(false);
  const [pausedBest, setPausedBest] = useState<ExchangeId | null>(null);

  const size = Number(sizeStr) || 0;
  const { base: baseAsset, quote: quoteAsset } = parsePair(tradingPair);

  const selectorBtnRef = useRef<HTMLButtonElement | null>(null);
  const didInitRef = useRef(false); // ensure initial setup only runs once
  const stickySentinelRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => slots.filter(Boolean) as ExchangeId[], [slots]);
  const pairDir = useMemo(() => new PairDirectory(), []);

  const { cardOrder, names, ids } = useExchangeCatalog();
  const { feeMeta, settings, defaultTierByEx, setSettings } = useExchangeSettings();
  const { pairOptions, pairMeta, loadingPairs } = usePairOptions();
  const supportedSetRaw = useSupportedExchanges({ tradingPair, pairDir, allowed: ids });

  const supportedSet = useMemo(() => {
    if (tradingPair === 'BTC/USDT' && supportedSetRaw.size === 0) {
      const seed = ids.length ? ids : cardOrder;
      return new Set<ExchangeId>([...seed] as ExchangeId[]);
    }
    return supportedSetRaw;
  }, [supportedSetRaw, tradingPair, ids, cardOrder]);

  const { books, costBreakdownMap, errors, rankedExchanges, calcTimestamps, priceBucket } =
    useExchangeEngine({
      tradingPair,
      size,
      sizeAsset,
      side,
      selected,
      supportedSet,
      defaultTierByEx,
      settings,
      paused,
      onSelectExchanges: (next) => {
        setSlots(() => {
          const sorted = [...next].sort((a, b) =>
            (names[a] ?? a).localeCompare(names[b] ?? b, undefined, { sensitivity: 'base' })
          );
          return [
            ...sorted,
            ...Array(Math.max(0, MAX_CARD_SLOTS - sorted.length)).fill(null),
          ] as (ExchangeId | null)[];
        });
      },
    });

  const selectorOptions = useMemo(
    () => cardOrder.map((id) => ({ id: id as ExchangeId, name: id as string })),
    [cardOrder]
  );

  // Auto-select supported exchanges when a trading pair is chosen
  useEffect(() => {
    if (didInitRef.current) return;
    if (cardOrder.length === 0) return;
    if (selected.length > 0) {
      didInitRef.current = true;
      return;
    }

    const initial = cardOrder.slice(0, MAX_CARD_SLOTS) as (ExchangeId | null)[];
    setSlots([...initial, ...Array(Math.max(0, MAX_CARD_SLOTS - initial.length)).fill(null)]);
    didInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardOrder.length, selected.length]);

  // Sticky header sentinel
  useEffect(() => {
    const el = stickySentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      root: null,
      threshold: 1,
    });

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Update paused best exchange when paused changes
  useEffect(() => {
    if (paused) setPausedBest((prev) => prev ?? rankedExchanges[0] ?? null);
    else setPausedBest(rankedExchanges[0] ?? null);
  }, [paused, rankedExchanges]);

  return (
    <div className="app-shell">
      <div className="container-xl relative">
        <div ref={stickySentinelRef} className="h-0 sm:hidden" />
        {/* Header */}
        <header
          className={[
            'sticky top-[env(safe-area-inset-top)] z-40 sm:static',
            'supports-[backdrop-filter]:backdrop-blur supports-[backdrop-filter]:bg-white/70 supports-[backdrop-filter]:dark:bg-zinc-950/60',
            'bg-transparent border-0 mb-3 sm:mb-5',
            stuck ? 'opacity-95' : 'opacity-100',
          ].join(' ')}
        >
          <div className="grid grid-cols-[auto,1fr,auto] items-center gap-x-3">
            {/* Logo */}
            <img
              src={/^((?!chrome|android).)*safari/i.test(navigator.userAgent) ? favicon : icon}
              alt=""
              className="h-8 w-8 sm:h-24 sm:w-24 shrink-0"
              decoding="sync"
              loading="eager"
            />

            <div className="min-w-0">
              <h1
                className="text-2xl sm:text-4xl font-bold leading-tight sm:leading-tight truncate"
                title="Crypto Trade Analyzer"
              >
                Crypto Trade Analyzer
              </h1>

              {/* Desktop */}
              <p className="header-subtitle mt-1 text-muted hidden sm:block">
                Identify the most cost-efficient exchange by comparing spend and receive amounts
                from simulated order execution, using real-time order book data and fees.
              </p>
            </div>

            <div className="ml-auto sm:ml-0 flex items-center gap-2 flex-shrink-0">
              <ThemeToggle />
            </div>

            {/* Mobile */}
            <div className="sm:hidden col-span-3 mt-1">
              <details className="sm:hidden group contents">
                <summary className="ml-11 cursor-pointer select-none text-sm text-primary inline-flex items-center gap-1 [&::-webkit-details-marker]:hidden">
                  <span>Overview</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>

                <p className="mt-2 text-muted">
                  Identify the most cost-efficient exchange by comparing spend and receive amounts
                  from simulated order execution, using real-time order book data and fees.
                </p>
              </details>
            </div>
          </div>

          <div
            className={[
              'sm:hidden mt-3 space-y-2 transition-opacity duration-200',
              stuck ? 'opacity-90' : 'opacity-100',
            ].join(' ')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Pill label="Spot" />
              <Pill label="Market Order" />

              <SegmentToggle
                size="sm"
                options={[
                  { label: 'Buy', value: 'buy' },
                  { label: 'Sell', value: 'sell' },
                ]}
                value={side}
                onChange={(v) => setSide(v as OrderSide)}
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
              {/* Pair */}
              <div className="h-11 flex items-center">
                <PairInput
                  value={tradingPair}
                  options={pairOptions}
                  metaByPair={pairMeta}
                  onChange={setTradingPair}
                  className="w-full"
                  placeholder={loadingPairs ? 'Loading…' : 'Search pair'}
                />
              </div>

              {/* Size */}
              <div className="h-11 flex items-center">
                <SizeInput
                  sizeStr={sizeStr}
                  baseAsset={baseAsset}
                  quoteAsset={quoteAsset}
                  sizeAsset={sizeAsset}
                  setSizeStr={setSizeStr}
                  onSizeAssetChange={setSizeAsset}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <DropdownButton
                ref={selectorBtnRef}
                label="Exchanges"
                open={selectorOpen}
                onClick={() => setSheetOpen((v) => !v)}
              />

              <div className="h-11 flex items-center">
                <div className="scale-90">
                  <PauseButton paused={paused} setPaused={setPaused} />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Top controls */}
        <div className="mb-6">
          <div className="hidden sm:flex sm:items-center sm:justify-between">
            <div tabIndex={-1} className="controls-rail flex-1 min-w-0">
              <Pill label="Spot" />
              <Pill label="Market Order" />

              <PairInput
                value={tradingPair}
                options={pairOptions}
                metaByPair={pairMeta}
                onChange={(val) => setTradingPair(val)}
                className="w-36 min-w-[10rem] sm:w-48 sm:min-w-[12rem]"
                placeholder={loadingPairs ? 'Loading…' : 'Trading pair'}
              />

              <SegmentToggle
                size="sm"
                options={[
                  { label: 'Buy', value: 'buy' },
                  { label: 'Sell', value: 'sell' },
                ]}
                value={side}
                onChange={(v) => setSide(v as OrderSide)}
              />

              <SizeInput
                sizeStr={sizeStr}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
                sizeAsset={sizeAsset}
                setSizeStr={setSizeStr}
                onSizeAssetChange={setSizeAsset}
                className="w-32 min-w-[9rem] sm:w-44 sm:min-w-[12rem] mr-6"
              />

              <DropdownButton
                ref={selectorBtnRef}
                label="Exchanges"
                open={selectorOpen}
                onClick={() => setSelectorOpen((v) => !v)}
              />
            </div>

            {selected.some((id) => supportedSet.has(id)) && (
              <div className="flex-shrink-0">
                <div className="scale-90">
                  <PauseButton paused={paused} setPaused={setPaused} />
                </div>
              </div>
            )}
          </div>

          {selectorOpen && (
            <ExchangeSelector
              anchorRef={selectorBtnRef}
              variant="dropdown"
              tradingPair={tradingPair}
              selected={selected}
              maxSlots={MAX_CARD_SLOTS}
              supportedSet={supportedSet}
              onApply={(next) => {
                setSlots(() => {
                  const sorted = [...next].sort((a, b) =>
                    (names[a] ?? a).localeCompare(names[b] ?? b, undefined, {
                      sensitivity: 'base',
                    })
                  );
                  return [
                    ...sorted,
                    ...Array(Math.max(0, MAX_CARD_SLOTS - sorted.length)).fill(null),
                  ] as (ExchangeId | null)[];
                });
                setSelectorOpen(false);
              }}
              options={selectorOptions}
            />
          )}

          <BottomSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Select Exchanges"
          >
            <ExchangeSelector
              variant="inline"
              tradingPair={tradingPair}
              selected={selected}
              maxSlots={MAX_CARD_SLOTS}
              supportedSet={supportedSet}
              options={selectorOptions}
              onApply={(next) => {
                setSlots(() => {
                  const sorted = [...next].sort((a, b) =>
                    (names[a] ?? a).localeCompare(names[b] ?? b, undefined, {
                      sensitivity: 'base',
                    })
                  );
                  return [
                    ...sorted,
                    ...Array(Math.max(0, MAX_CARD_SLOTS - sorted.length)).fill(null),
                  ] as (ExchangeId | null)[];
                });
                setSheetOpen(false);
              }}
            />
          </BottomSheet>
        </div>

        {/* Cards */}
        <div className="cards-rail custom-scrollbar">
          <div className="cards-grid">
            {slots.map((slotExId, idx) => {
              const isSelected = !!slotExId;
              const id = slotExId as ExchangeId;
              const exchangeName = isSelected && id ? names[id] : '';
              const unsupported =
                isSelected && id ? (tradingPair ? !supportedSet.has(id) : true) : false;
              const costBreakdown = isSelected && id ? costBreakdownMap[id] : undefined;
              const err = isSelected && id ? errors[id] : null;
              const effectiveBestId = paused ? pausedBest : rankedExchanges[0];

              const isBest =
                isSelected &&
                id &&
                (paused
                  ? id === effectiveBestId
                  : effectiveBestId === id && !unsupported && !err && !!costBreakdown);
              const lastCalculationTime = isSelected && id ? calcTimestamps[id] : undefined;

              return (
                <ExchangeCard
                  key={id ?? `slot-${idx}`}
                  exchangeId={id}
                  exchangeName={exchangeName}
                  supportsTokenDiscount={
                    isSelected && id ? !!feeMeta[id]?.supportsTokenDiscount : false
                  }
                  defaultTier={isSelected && id ? (feeMeta[id]?.defaultTier ?? '') : ''}
                  userTiers={isSelected && id ? feeMeta[id]?.userTiers : undefined}
                  selectedExchanges={selected}
                  supportedExchanges={supportedSet}
                  isSelected={isSelected}
                  isBest={!!isBest}
                  rankedExchanges={rankedExchanges}
                  books={books}
                  costBreakdownMap={costBreakdownMap as Record<ExchangeId, CostBreakdown>}
                  precision={priceBucket ? countDecimals(priceBucket) : undefined}
                  error={err}
                  tradingPair={tradingPair}
                  size={size}
                  settings={isSelected && id ? settings[id] : undefined}
                  lastCalculationTime={lastCalculationTime}
                  paused={paused}
                  onChangeSettings={(p) => {
                    if (!isSelected || !id) return;
                    setSettings(id, p);
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-8 pb-8 text-xs text-muted">
          Live order books and fees via exchanges’ public APIs • Pair data and USD conversions via
          CoinPaprika, CryptoCompare, and CoinGecko APIs. •{' '}
          <Link className="underline" to="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Use
          </Link>
        </div>

        <CookieConsentBox />
      </div>
    </div>
  );
}

/**
 * HomePage component that renders the main application or terms gate based on user consent.
 *
 * This component checks if the user has accepted the terms and conditions.
 * If terms are not accepted, it displays the TermsModal component.
 * Otherwise, it renders the main application.
 *
 * @returns {JSX.Element} Either the TermsModal component or the MainApp component
 */
export default function HomePage(): JSX.Element | null {
  const { accepted } = useTermsConsent();
  if (!accepted) return <TermsModal />;
  return <MainApp />;
}
