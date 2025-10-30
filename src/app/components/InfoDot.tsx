import type { JSX } from 'react';

/**
 * Renders a small circular info button with an "i" icon.
 *
 * @param onClick - Callback function invoked when the button is clicked.
 * @param title - Optional tooltip text displayed on hover. Defaults to "More info".
 *
 * @returns A styled button element for displaying additional information.
 */
export function InfoDot({
  onClick,
  title = 'More info',
}: {
  onClick: () => void;
  title?: string;
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className="info-dot">
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden>
        <path
          d="M12 17v-6m0-3h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
