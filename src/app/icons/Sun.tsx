import type { JSX } from 'react';

/**
 * Renders a sun icon as an SVG element.
 *
 * @param props - React SVG props to customize the SVG element.
 * @returns A React element representing a sun icon.
 */
export function Sun(props: React.SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 6.364-1.414-1.414M7.464 7.464 6.05 6.05m11.314 0-1.414 1.414M7.464 16.95 6.05 18.364M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
      />
    </svg>
  );
}
