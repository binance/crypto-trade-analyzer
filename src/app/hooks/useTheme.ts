import { useEffect, useState } from 'react';
type Theme = 'light' | 'dark';

/**
 * Custom React hook to manage and persist the application's theme (light or dark).
 *
 * - Initializes the theme from `localStorage` if available, otherwise uses the user's system preference.
 * - Applies the theme by toggling the `dark` class on the document's root element.
 * - Persists theme changes to `localStorage`.
 *
 * @returns A tuple containing:
 *   - The current theme (`'light'` or `'dark'`)
 *   - A function to toggle between light and dark themes
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const cachedTheme = (typeof localStorage !== 'undefined' &&
      localStorage.getItem('theme')) as Theme | null;

    if (cachedTheme === 'light' || cachedTheme === 'dark') return cachedTheme;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    )
      return 'dark';

    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');

    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
