import type { JSX } from 'react';
import { InfoDot } from './InfoDot';

/**
 * Renders a single row displaying a cost item with an optional label, info button, and extra content on the right.
 *
 * @param label - The main text label for the cost row.
 * @param rightExtras - Optional React node to display on the right side of the row.
 * @param onInfo - Optional callback function triggered when the info button is clicked.
 */
export function CostRow({
  label,
  rightExtras,
  onInfo,
}: {
  label: string;
  rightExtras?: React.ReactNode;
  onInfo?: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span
          className="min-w-0 whitespace-normal break-words hyphens-auto leading-tight
                     text-[13px] sm:text-sm [text-wrap:balance]"
          title={label}
        >
          {label}
        </span>

        {onInfo ? (
          <InfoDot onClick={onInfo} />
        ) : (
          <span aria-hidden className="inline-block w-4 h-4 shrink-0" />
        )}

        {rightExtras ? <span className="shrink-0 -ml-0.5">{rightExtras}</span> : null}
      </div>
    </div>
  );
}
