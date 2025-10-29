import type { JSX } from 'react';

/**
 * Renders a single row in a live order book table, displaying price, size, total, and depth percentage.
 *
 * @param side - Indicates whether the row represents a 'bid' or an 'ask'.
 * @param priceText - The price value to display, formatted as a string.
 * @param sizeText - The size value to display, formatted as a string.
 * @param totalText - The cumulative total value to display, formatted as a string.
 * @param depthPct - The depth percentage for the row, used for visual representation.
 * @returns A JSX element representing the order book row.
 */
export function LiveOrderBookRow({
  side,
  priceText,
  sizeText,
  totalText,
  depthPct,
}: {
  side: 'bid' | 'ask';
  priceText: string;
  sizeText: string;
  totalText: string;
  depthPct: number;
}): JSX.Element {
  const isBid = side === 'bid';
  const pct = Math.max(0, Math.min(100, depthPct));
  const depthLabel = `${pct.toFixed(1)}%`;

  return (
    <tr
      className={`ob-row ${isBid ? 'bid' : 'ask'} h-6`}
      style={{ ['--depth-pct' as never]: `${pct}%` }}
      data-depth={depthLabel}
    >
      <td className={`ob-price ${isBid ? 'bid' : 'ask'} px-1 font-mono tabular-nums`}>
        {priceText}
      </td>
      <td className="text-right font-mono tabular-nums text-muted-strong pr-3">{sizeText}</td>
      <td className="text-right font-mono tabular-nums text-muted-strong">{totalText}</td>
    </tr>
  );
}
