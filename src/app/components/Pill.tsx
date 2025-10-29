import type { JSX } from 'react';

/**
 * Renders a pill-shaped UI element with a label and a lock icon.
 *
 * @param label - The text to display inside the pill.
 * @returns A styled span element containing the label and a lock SVG icon.
 */
export function Pill({ label }: { label: string }): JSX.Element {
  return (
    <span
      title={`${label} (locked)`}
      aria-label={`${label} (locked)`}
      className="pill text-muted-strong"
    >
      {label}
      <svg
        className="pill-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        <path d="M19 11V7a7 7 0 0 0-14 0v4" />
        <rect x="5" y="11" width="14" height="10" rx="2" />
      </svg>
    </span>
  );
}
