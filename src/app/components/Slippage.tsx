import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { CostRow } from './CostRow';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table row displaying slippage information, including crypto and fiat values.
 * Provides an expandable info panel explaining slippage when the info key is set to 'Slippage'.
 *
 * @param costBreakdown - Object containing slippage values in base and USD formats.
 * @param precision - Optional number of decimal places to format the crypto value.
 * @param openInfoKey - The currently open info panel key, or null if none is open.
 * @param setOpenInfoKey - State setter to toggle the open info panel key.
 */
export function Slippage({
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
            label="Slippage"
            onInfo={() => setOpenInfoKey((k) => (k === 'Slippage' ? null : 'Slippage'))}
          />
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {cryptoNumberFormat(costBreakdown.slippage.amount, {
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
            {fiatNumberFormat(costBreakdown.slippage.usd)}
          </span>
        </td>
      </tr>

      {openInfoKey === 'Slippage' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1">
            <div className="info-card text-sm">
              Estimated difference between expected execution price and actual execution price.
              Shown for reference only.
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
