import { useTheme } from '../hooks/useTheme';
import { Sun } from '../icons/Sun';
import { Moon } from '../icons/Moon';
import type { JSX } from 'react';

/**
 * A button component that toggles between light and dark themes.
 *
 * @param className - Optional additional CSS classes to apply to the button.
 * @returns A button element that switches the application's theme when clicked.
 *
 * The button displays a sun icon in light mode and a moon icon in dark mode.
 * It includes accessible labels and supports keyboard focus styling.
 */
export function ThemeToggle({ className = '' }: { className?: string }): JSX.Element {
  const [theme, toggle] = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`theme-toggle ${className}`}
    >
      {dark ? <Sun className="h-5 w-5 icon-sun" /> : <Moon className="h-5 w-5 icon-moon" />}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
