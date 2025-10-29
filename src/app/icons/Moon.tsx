import type { JSX } from 'react';

/**
 * Renders a Moon SVG icon.
 *
 * @param props - React SVG props to customize the icon.
 * @returns A React element representing a moon icon.
 */
export function Moon(props: React.SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
      />
    </svg>
  );
}
