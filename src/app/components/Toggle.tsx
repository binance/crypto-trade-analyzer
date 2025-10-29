import { useId, type JSX } from 'react';

/**
 * A toggle switch component for boolean values.
 *
 * @param checked - Indicates whether the toggle is in the "on" position.
 * @param disabled - If true, the toggle is disabled and cannot be interacted with.
 * @param onChange - Callback function invoked with the new checked value when the toggle is clicked.
 * @param label - Optional label text displayed next to the toggle.
 * @param className - Optional additional CSS classes to apply to the toggle button.
 *
 * @returns A styled button element representing the toggle switch.
 */
export function Toggle({
  checked,
  disabled = false,
  onChange,
  label,
  className = '',
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}): JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
    if (e.key === 'ArrowLeft') onChange(false);
    if (e.key === 'ArrowRight') onChange(true);
  };

  return (
    <div className={['flex items-center gap-2', className].join(' ')}>
      {label && <span className="control-label">{label}</span>}

      <button
        id={useId()}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={onKeyDown}
        aria-label={label || 'Toggle'}
        className={[
          'switch',
          checked ? 'switch--on' : 'switch--off',
          disabled ? 'switch--disabled' : 'cursor-pointer',
          className,
        ].join(' ')}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}
