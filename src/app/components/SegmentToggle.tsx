import type { JSX } from 'react';

/**
 * A segmented toggle component for selecting between multiple options.
 *
 * @param options - Array of option objects, each with a `label` and `value`.
 * @param value - The currently selected option's value.
 * @param onChange - Callback invoked with the new value when an option is selected.
 * @param className - Optional additional CSS classes for the root element.
 * @param size - Optional size of the toggle, either `'sm'` (small) or `'md'` (medium). Defaults to `'md'`.
 * @param fullWidth - If true, the toggle stretches to fill the width of its container. Defaults to false.
 *
 * @remarks
 * - Visually displays options as a segmented control.
 * - Applies different padding and font sizes based on the `size` prop.
 * - Uses accessible roles and aria attributes for better accessibility.
 */
export function SegmentToggle({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
  fullWidth = false,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}): JSX.Element {
  const activeIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = options[(activeIdx + dir + options.length) % options.length];
    onChange(next.value);
  }

  return (
    <div
      className={`seg ${className}`}
      role="radiogroup"
      aria-label="Side"
      onKeyDown={onKeyDown}
      style={{ display: fullWidth ? ('flex' as const) : 'inline-flex' }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={[
              'seg-btn',
              size === 'sm' ? 'seg-btn-sm' : 'seg-btn-md',
              active ? 'seg-btn-active' : 'seg-btn-inactive',
            ].join(' ')}
            style={{ flex: fullWidth ? '1 1 0%' : '0 0 auto' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
