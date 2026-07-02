import { cryptoNumberFormat, fiatNumberFormat } from '../../utils/utils';
import { CostRow } from './CostRow';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table row displaying projected funding cost for a perpetual-futures position.
 * Only meaningful when `costBreakdown.funding` is present (futures mode). A positive value is
 * a cost to the trader; a negative value is a credit. Folded into the exchange ranking.
 *
 * @param costBreakdown - Object containing the optional funding cost item and holding period.
 * @param precision - Optional number of decimal places to format the quote value.
 * @param openInfoKey - The currently open info panel key, or null if none is open.
 * @param setOpenInfoKey - State setter to toggle the open info panel key.
 */
export function Funding({
  costBreakdown,
  precision,
  adaptiveQuote = false,
  openInfoKey,
  setOpenInfoKey,
}: {
  costBreakdown: CostBreakdown;
  precision?: number;
  adaptiveQuote?: boolean;
  openInfoKey: OpenInfoKey | null;
  setOpenInfoKey: React.Dispatch<React.SetStateAction<OpenInfoKey | null>>;
}): JSX.Element | null {
  const funding = costBreakdown.funding;
  const hours = costBreakdown.holdingPeriodHours;

  if (!funding) {
    if (!costBreakdown.fundingMissing) return null;

    return (
      <>
        <tr className="group transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
          <td className="relative py-2 pr-2 whitespace-normal break-words leading-snug [text-wrap:balance] before:bg-transparent group-hover:before:bg-white/20">
            <CostRow
              label={hours ? `Funding (${hours}h)` : 'Funding'}
              onInfo={() => setOpenInfoKey((k) => (k === 'Funding' ? null : 'Funding'))}
            />
          </td>
          <td
            colSpan={2}
            className="py-2 text-right font-mono text-amber-500 whitespace-nowrap overflow-hidden text-ellipsis"
          >
            unavailable
          </td>
        </tr>

        {openInfoKey === 'Funding' && (
          <tr>
            <td colSpan={3} className="pb-3 pt-1">
              <div className="info-card text-sm">
                Funding data couldn’t be fetched for this exchange right now, so its projected
                funding is excluded from the comparison and treated as zero. That understates its
                cost relative to exchanges with available funding — the ranking may be unfair until
                the rate loads. It usually recovers on the next refresh.
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <>
      <tr className="group transition-colors hover:dark:bg-white/5 hover:bg-gray-900/5">
        <td className="relative py-2 pr-2 whitespace-normal break-words leading-snug [text-wrap:balance] before:bg-transparent group-hover:before:bg-white/20">
          <CostRow
            label={hours ? `Funding (${hours}h)` : 'Funding'}
            onInfo={() => setOpenInfoKey((k) => (k === 'Funding' ? null : 'Funding'))}
          />
        </td>
        <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="block text-right tabular font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {adaptiveQuote
              ? fiatNumberFormat(funding.amount)
              : cryptoNumberFormat(funding.amount, {
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
            {fiatNumberFormat(funding.usd)}
          </span>
        </td>
      </tr>

      {openInfoKey === 'Funding' && (
        <tr>
          <td colSpan={3} className="pb-3 pt-1">
            <div className="info-card text-sm">
              Projected funding over your selected holding period
              {hours ? ` (${hours}h)` : ''}, assuming the current funding rate
              {funding.rate != null
                ? `, ${(funding.rate * 100).toFixed(4)}% per ${costBreakdown.fundingIntervalHours ?? 8}h`
                : ''}{' '}
              funding interval, remains unchanged. Actual funding may vary due to changes including,
              but not limited to, funding rates, settlement timing, and market prices.
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                <li>
                  Positive funding rate: longs/buy positions pay, shorts/sell positions receive.
                </li>
                <li>
                  Negative funding rate: longs/buy positions receive, shorts/sell positions pay.
                </li>
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
