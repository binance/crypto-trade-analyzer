import type { JSX } from 'react';

/**
 * Renders a corner ribbon component, typically used to highlight a feature such as "Best".
 *
 * @param label - The text to display on the ribbon. Defaults to "Best".
 *
 * @remarks
 * The ribbon is positioned absolutely in the top-right corner and styled using Tailwind CSS classes.
 */
export function CornerRibbon({ label = 'Best' }: { label?: string }): JSX.Element {
  return (
    <div className="ribbon-wrap">
      <div className="ribbon">{label}</div>
    </div>
  );
}
