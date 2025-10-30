import type { JSX } from 'react';

/**
 * Renders a pause icon as an SVG element.
 *
 * @returns {JSX.Element} The SVG representation of a pause icon.
 */
export function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
    </svg>
  );
}
