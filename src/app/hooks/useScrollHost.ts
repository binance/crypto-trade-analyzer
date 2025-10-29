import { useState, useEffect } from 'react';

/**
 * Finds the nearest scrollable parent element of a given HTML element.
 *
 * Traverses up the DOM tree starting from the provided node, checking each parent
 * element's `overflowY` CSS property to determine if it's scrollable. Returns the
 * first parent element with `overflow-y` set to `auto` or `scroll`, or the `window`
 * object if no scrollable parent is found.
 *
 * @param node - The HTML element to start searching from. Can be null.
 * @returns The nearest scrollable parent element, or the window object if none found.
 */
function getScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let p: HTMLElement | null = node?.parentElement ?? null;
  while (p) {
    const style = p ? getComputedStyle(p) : null;
    const oy = style?.overflowY;
    if (oy && /(auto|scroll)/.test(oy)) return p!;
    p = p?.parentElement ?? null;
  }
  return window;
}

/**
 * Custom React hook that determines and returns the scroll host element for a given trigger element.
 *
 * @param triggerEl - The HTMLElement for which to find the scroll host. Can be `null`.
 * @returns The scroll host HTMLElement, defaulting to `document.body` if none is found.
 *
 * The hook uses `getScrollParent` to find the nearest scrollable ancestor of the trigger element.
 * If the scroll parent is the `window`, it returns `document.body` instead.
 * The hook updates the scroll host whenever the `triggerEl` changes.
 */
export function useScrollHost(triggerEl: HTMLElement | null) {
  const [hostEl, setHostEl] = useState<HTMLElement>(document.body);

  useEffect(() => {
    if (!triggerEl) return;
    const sp = getScrollParent(triggerEl);
    setHostEl(sp === window ? document.body : (sp as HTMLElement));
  }, [triggerEl]);

  return hostEl;
}
