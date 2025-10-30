/**
 * Chevron icon component that rotates based on the `open` prop.
 *
 * @param open - Determines if the chevron should be rotated (typically to indicate expanded/collapsed state).
 * @returns A SVG chevron icon.
 */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
