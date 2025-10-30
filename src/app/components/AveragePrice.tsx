import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { CostRow } from './CostRow';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table row displaying the average price information for a crypto exchange transaction.
 *
 * @param costBreakdown - Object containing breakdown of costs including average price and USD equivalent.
 * @param precision - Optional number of decimal places to display for the average price.
 * @param openInfoKey - The key indicating which info card is currently open.
 * @param setOpenInfoKey - Function to update the open info card key.
 * @returns JSX.Element containing the average price row and an optional info card.
 */
export function AveragePrice({
  costBreakdown,
  precision,
  openInfoKey,
  setOpenInfoKey,
}: {
  costBreakdown: CostBreakdown;
  precision?: number;
  openInfoKey: OpenInfoKey | null;
  setOpenInfoKey: React.Dispatch<React.SetStateAction<OpenInfoKey | null>>;
}): JSX.Element {
  return (
    <>
      <tr className="group transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
        <td className="relative py-2 pr-2 whitespace-normal break-words leading-snug [text-wrap:balance] before:bg-transparent group-hover:before:bg-white/20">
          <CostRow
            label="Avg Price"
            onInfo={() => setOpenInfoKey((k) => (k === 'Avg Price' ? null : 'Avg Price'))}
          />
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {cryptoNumberFormat(costBreakdown.averagePrice, {
              ...(precision && {
                minDecimals: precision > 2 ? precision : 2,
                maxDecimals: precision,
                minSig: precision,
                maxSig: precision,
              }),
            })}
          </span>
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {fiatNumberFormat(costBreakdown.averagePriceUsd)}
          </span>
        </td>
      </tr>

      {openInfoKey === 'Avg Price' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1">
            <div className="info-card text-sm">
              Depth-weighted average execution price across all filled levels.{' '}
              {costBreakdown.quoteAsset.toUpperCase()} column shows price per unit and USD column
              shows price in USD. Includes price impact (slippage).
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
