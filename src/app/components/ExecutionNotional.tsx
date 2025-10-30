import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { CostRow } from './CostRow';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table row displaying the execution notional value, including crypto and fiat representations.
 * Shows additional information when the info key is set to 'Execution Notional'.
 *
 * @param costBreakdown - Object containing cost breakdown details
 * @param precision - Optional number of decimal places to format the crypto value.
 * @param openInfoKey - The currently open info key, used to toggle the info panel for execution notional.
 * @param setOpenInfoKey - State setter to update the open info key.
 *
 * Displays a description explaining that the execution notional is the value of the order filled at the depth-weighted average execution price,
 * already including price impact (slippage), with fees shown separately.
 */
export function ExecutionNotional({
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
            label="Notional"
            onInfo={() => setOpenInfoKey((k) => (k === 'Notional' ? null : 'Notional'))}
          />
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {cryptoNumberFormat(costBreakdown.execution.amount, {
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
            {fiatNumberFormat(costBreakdown.execution.usd)}
          </span>
        </td>
      </tr>

      {openInfoKey === 'Notional' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1">
            <div className="info-card text-sm">
              Trade value at the depth-weighted average execution price. This already includes price
              impact (slippage).
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
