import type { JSX } from 'react';

/**
 * Renders a play icon as an SVG element.
 *
 * @returns {JSX.Element} The SVG play icon.
 *
 * @example
 * <PlayIcon />
 */
export function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}
