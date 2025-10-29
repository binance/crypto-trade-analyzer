import { forwardRef, type JSX } from 'react';
import { Chevron } from '../icons/Chevron';

/**
 * A button component that toggles a dropdown menu.
 *
 * @param label - The text label displayed on the button.
 * @param open - Whether the dropdown is currently open.
 * @param onClick - Handler for the button's click event.
 * @param countText - Optional text to display next to the label, typically used for item counts.
 * @param disabled - Whether the button is disabled. Defaults to `false`.
 * @param variant - The visual variant of the button. Can be "default", "primary", or "secondary". Defaults to "default".
 * @param ref - Ref forwarded to the button element.
 *
 * @remarks
 * This component displays a button with a label, an optional count text, and a chevron icon indicating the dropdown state.
 * It supports accessibility features such as `aria-haspopup` and `aria-expanded`.
 *
 * @example
 * ```tsx
 * <DropdownButton
 *   label="Options"
 *   open={isOpen}
 *   onClick={handleClick}
 *   countText="3"
 *   disabled={false}
 *   ref={buttonRef}
 * />
 * ```
 */
export const DropdownButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    open: boolean;
    onClick: () => void;
    countText?: string;
    disabled?: boolean;
    variant?: 'default' | 'primary' | 'secondary';
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>
>(
  (
    { label, open, onClick, countText, disabled = false, className: cls, ...rest },
    ref
  ): JSX.Element => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          'btn-secondary',
          open ? 'btn-secondary-open' : 'focus-visible:ring-2 focus-visible:ring-sky-500',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
          cls ?? '',
        ].join(' ')}
        {...rest}
      >
        <span>{label}</span>
        {countText ? <span className="text-xs text-muted">({countText})</span> : null}
        <Chevron open={open} />
      </button>
    );
  }
);

DropdownButton.displayName = 'DropdownButton';
