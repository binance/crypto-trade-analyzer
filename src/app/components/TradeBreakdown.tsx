import { AveragePrice } from './AveragePrice';
import { ExecutionNotional } from './ExecutionNotional';
import { CommissionFees } from './CommissionFees';
import { Slippage } from './Slippage';
import { Chevron } from '../icons/Chevron';
import type { CostBreakdown } from '../../core/interfaces/fee-config';
import type { JSX } from 'react';
import type { ExchangeId } from '../../exchanges';
import type { OpenInfoKey } from '../types';

/**
 * Renders a table displaying a detailed breakdown of trade costs for a given exchange.
 *
 * @param exchangeId - The ID of the exchange for which to display the breakdown.
 * @param costBreakdownMap - A mapping of exchange IDs to their respective cost breakdown data.
 * @param precision - Optional number of decimal places to display for numeric values.
 * @param feesOpen - Boolean indicating whether the fees details section is expanded.
 * @param openInfoKey - The key indicating which info section is currently open.
 * @param setFeesOpen - Function to update the fees open state.
 * @param setOpenInfoKey - Function to update the open info key state.
 * @param breakdownOpen - Boolean indicating whether the entire breakdown section is expanded.
 * @param setBreakdownOpen - Function to update the breakdown open state.
 * @returns A JSX element containing the trade breakdown table.
 */
export function TradeBreakdown({
  exchangeId,
  costBreakdownMap,
  precision,
  feesOpen,
  openInfoKey,
  breakdownOpen,
  setFeesOpen,
  setOpenInfoKey,
  setBreakdownOpen,
}: {
  exchangeId: ExchangeId;
  costBreakdownMap: Record<ExchangeId, CostBreakdown>;
  precision?: number;
  feesOpen: boolean;
  openInfoKey: OpenInfoKey | null;
  breakdownOpen: boolean;
  setFeesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOpenInfoKey: React.Dispatch<React.SetStateAction<OpenInfoKey | null>>;
  setBreakdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): JSX.Element {
  const costBreakdown = costBreakdownMap[exchangeId];

  return (
    <table className="w-full text-sm text-strong table-fixed">
      <colgroup>
        <col className="min-w-[8ch] xs:min-w-[6ch] sm:min-w-[6ch] md:min-w-[12ch] w-auto" />
        <col className="w-[8ch] max-xs:w-[12ch] xs:w-[12ch] max-sm:w-[12ch] sm:w-[12ch] md:w-[11ch]" />
        <col className="w-[8ch] max-xs:w-[13ch] xs:w-[13ch] max-sm:w-[13ch] sm:w-[13ch] md:w-[12ch]" />
      </colgroup>

      <thead>
        <tr className="table-head">
          <th className="text-left py-2 font-medium">
            <div className="inline-flex items-center gap-1">
              <span>Trade Breakdown</span>
              <button
                type="button"
                onClick={() => setBreakdownOpen((v) => !v)}
                aria-expanded={breakdownOpen}
                aria-controls={`tb-body-${exchangeId}`}
                className="btn-ghost-muted p-0 h-5 w-5 grid place-items-center"
                title={breakdownOpen ? 'Collapse trade breakdown' : 'Expand trade breakdown'}
              >
                <Chevron open={breakdownOpen} />
              </button>
            </div>
          </th>
          <th className="text-right tabular py-2 font-medium">
            {breakdownOpen ? costBreakdown.quoteAsset : ''}
            <span className="sr-only">{!breakdownOpen ? costBreakdown.quoteAsset : ''}</span>
          </th>
          <th className="text-right tabular py-2 font-medium">
            {breakdownOpen ? 'USD' : ''}
            <span className="sr-only">{!breakdownOpen ? 'USD' : ''}</span>
          </th>
        </tr>
      </thead>

      {breakdownOpen && (
        <tbody id={`tb-body-${exchangeId}`} className="align-middle">
          <AveragePrice
            costBreakdown={costBreakdown}
            precision={precision}
            openInfoKey={openInfoKey}
            setOpenInfoKey={setOpenInfoKey}
          />

          <Slippage
            costBreakdown={costBreakdown}
            precision={precision}
            openInfoKey={openInfoKey}
            setOpenInfoKey={setOpenInfoKey}
          />

          <ExecutionNotional
            costBreakdown={costBreakdown}
            precision={precision}
            openInfoKey={openInfoKey}
            setOpenInfoKey={setOpenInfoKey}
          />

          <CommissionFees
            costBreakdown={costBreakdown}
            precision={precision}
            feesOpen={feesOpen}
            openInfoKey={openInfoKey}
            setFeesOpen={setFeesOpen}
            setOpenInfoKey={setOpenInfoKey}
          />
        </tbody>
      )}
    </table>
  );
}
