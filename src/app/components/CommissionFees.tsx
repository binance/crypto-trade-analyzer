import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { Chevron } from '../icons/Chevron';
import { CostRow } from './CostRow';
import { CommissionFeesDetails } from './CommissionFeesDetails';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table row displaying commission fee information for a crypto exchange transaction,
 * including the fee amount in quote asset and USD, and an info card explaining fee calculation.
 *
 * @param costBreakdown - The breakdown of costs for the transaction, including side, assets, and trading fee details.
 * @param precision - Optional number of decimal places to display for the fee amount.
 * @param feesOpen - Boolean indicating whether the fees details section is expanded.
 * @param openInfoKey - The key indicating which info card is currently open.
 * @param setFeesOpen - Function to update the fees open state.
 * @param setOpenInfoKey - Function to update the open info card key.
 * @returns JSX.Element containing table rows for fee display and details.
 */
export function CommissionFees({
  costBreakdown,
  precision,
  feesOpen,
  openInfoKey,
  setFeesOpen,
  setOpenInfoKey,
}: {
  costBreakdown: CostBreakdown;
  precision?: number;
  feesOpen: boolean;
  openInfoKey: OpenInfoKey | null;
  setFeesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOpenInfoKey: React.Dispatch<React.SetStateAction<OpenInfoKey | null>>;
}): JSX.Element {
  return (
    <>
      <tr className="group transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
        <td className="relative py-2 pr-2 whitespace-normal break-words leading-snug [text-wrap:balance] before:bg-transparent group-hover:before:bg-white/20">
          <CostRow
            label="Fees"
            onInfo={() => setOpenInfoKey((k) => (k === 'Fees' ? null : 'Fees'))}
            rightExtras={
              <button
                type="button"
                onClick={() => setFeesOpen((v) => !v)}
                aria-expanded={feesOpen}
                title="Show fee details"
                className="btn-ghost-muted p-0 h-5 w-5 grid place-items-center"
              >
                <Chevron open={feesOpen} />
              </button>
            }
          />
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {cryptoNumberFormat(costBreakdown.tradingFee.amountInQuote!, {
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
            {fiatNumberFormat(costBreakdown.tradingFee.usd)}
          </span>
        </td>
      </tr>

      {/* Collapsible details */}
      {feesOpen && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1 pl-4 md:pl-5">
            <div className="relative">
              <div aria-hidden className="guideline" />
              <CommissionFeesDetails costBreakdown={costBreakdown} />
            </div>
          </td>
        </tr>
      )}

      {openInfoKey === 'Fees' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1">
            <div className="info-card text-sm">
              Fees = Execution Notional × Taker Fee. The Taker Fee rate reflects the chosen User
              Tier and any applicable discounts (e.g., token-discount campaigns or custom fee
              overrides). Fees may be charged in base, quote, or another token; the tool converts
              and applies them so the Spend/Receive figures already include all fees.
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
