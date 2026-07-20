import type { JSX } from 'react';
import type { BookView } from '../../core/interfaces/order-book';

const ASK = 'rgb(239 83 80)';
const BID = 'rgb(38 166 154)';
const MUTED = 'currentColor';

/**
 * Binance-style order book view icon: a small stacked-square marker on the left indicating which
 * sides are active, plus a column of horizontal bars on the right (ask-colored on top, bid on
 * bottom) that fade out for the hidden side. Always rendered in the red/green side colors; the
 * selected/unselected distinction is carried by the wrapper's opacity.
 */
function ViewIcon({ mode }: { mode: BookView }): JSX.Element {
  const showAsk = mode !== 'bids';
  const showBid = mode !== 'asks';

  // Left marker: two small stacked squares (top = ask, bottom = bid).
  const topColor = showAsk ? ASK : MUTED;
  const botColor = showBid ? BID : MUTED;

  // Right bars: 3 ask rows (top) + 3 bid rows (bottom). Muted when side is hidden.
  const bars = [
    { y: 1.5, color: showAsk ? ASK : MUTED, opacity: showAsk ? 1 : 0.2 },
    { y: 5, color: showAsk ? ASK : MUTED, opacity: showAsk ? 1 : 0.2 },
    { y: 8.5, color: showAsk ? ASK : MUTED, opacity: showAsk ? 1 : 0.2 },
    { y: 13, color: showBid ? BID : MUTED, opacity: showBid ? 1 : 0.2 },
    { y: 16.5, color: showBid ? BID : MUTED, opacity: showBid ? 1 : 0.2 },
    { y: 20, color: showBid ? BID : MUTED, opacity: showBid ? 1 : 0.2 },
  ];

  return (
    <svg viewBox="0 0 22 23" className="h-[18px] w-[18px]" aria-hidden="true">
      {/* Left marker: top square (ask) */}
      <rect
        x={0}
        y={1}
        width={5}
        height={9.5}
        rx={0.5}
        fill={topColor}
        opacity={showAsk ? 1 : 0.2}
      />
      {/* Left marker: bottom square (bid) */}
      <rect
        x={0}
        y={12.5}
        width={5}
        height={9.5}
        rx={0.5}
        fill={botColor}
        opacity={showBid ? 1 : 0.2}
      />
      {/* Right bars */}
      {bars.map((b, i) => (
        <rect
          key={i}
          x={7}
          y={b.y}
          width={15}
          height={2}
          rx={0.5}
          fill={b.color}
          opacity={b.opacity}
        />
      ))}
    </svg>
  );
}

/**
 * Segmented icon toggle for the order book view: combined, bids-only, asks-only.
 * Styled after the exchange-standard switcher (Binance/OKX/Bybit): top-left of the book toolbar.
 */
export function BookViewToggle({
  value,
  onChange,
}: {
  value: BookView;
  onChange: (v: BookView) => void;
}): JSX.Element {
  const modes: { mode: BookView; label: string }[] = [
    { mode: 'both', label: 'Bids and asks' },
    { mode: 'bids', label: 'Bids only' },
    { mode: 'asks', label: 'Asks only' },
  ];

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Order book view">
      {modes.map(({ mode, label }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={[
              'inline-flex items-center justify-center rounded p-0.5 transition',
              'focus:outline-none focus-visible:ring-2',
              active ? 'opacity-100' : 'opacity-35 hover:opacity-65',
            ].join(' ')}
            style={{ ['--tw-ring-color' as never]: 'rgb(var(--focus))' }}
          >
            <ViewIcon mode={mode} />
          </button>
        );
      })}
    </div>
  );
}
