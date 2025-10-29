import type { JSX } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders an invisible spacer element into a specified host element using a React portal.
 * The spacer is used to reserve vertical space, typically for positioning popovers or overlays.
 *
 * @param host - The DOM element where the spacer will be rendered.
 * @param height - The height of the spacer in pixels. If less than or equal to 0, nothing is rendered.
 * @returns A JSX element representing the spacer, or null if height is <= 0.
 */
export function Spacer({
  host,
  height,
}: {
  host: HTMLElement;
  height: number;
}): JSX.Element | null {
  if (height <= 0) return null;
  return createPortal(
    <div
      data-cc-popover-spacer
      style={{
        visibility: 'hidden',
        pointerEvents: 'none',
        height: Math.max(height, 0) + 16,
        width: 1,
        margin: 0,
        padding: 0,
      }}
    />,
    host
  );
}
