import { useEffect, useRef, useState, type JSX } from 'react';
import { Check, Share, X } from 'lucide-react';
import { buildShareUrl, type ShareState } from '../../utils/share-url';

type ShareStatus = 'idle' | 'copied' | 'error';

/**
 * Fallback copy function for browsers that don't support the async clipboard API. It creates a hidden textarea, selects its content, and executes the copy command.
 *
 * @param text - The text to copy to the clipboard.
 * @returns A boolean indicating whether the copy command was successful.
 */
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');

  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.setAttribute('readonly', '');

  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();

    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Icon button that copies a shareable URL encoding the current analyzer view to the clipboard.
 *
 * On click it builds the URL from the supplied view state, writes it to the clipboard, and shows
 * a transient confirmation. Falls back to a hidden-textarea copy when the async clipboard API is
 * unavailable, for example in non-secure contexts.
 *
 * @param state - The current view state: market, pair, side, size, sizeAsset, hold, exchanges.
 * @param className - Optional additional CSS classes.
 */
export function ShareButton({
  state,
  className = '',
}: {
  state: ShareState;
  className?: string;
}): JSX.Element {
  const [status, setStatus] = useState<ShareStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const resetStatusSoon = () => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => setStatus('idle'), 1500);
  };

  const copy = async () => {
    const url = buildShareUrl(state);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const copied = fallbackCopy(url);

        if (!copied) throw new Error('Fallback copy command failed');
      }

      setStatus('copied');
      resetStatusSoon();
    } catch (error) {
      console.warn('Failed to copy share URL', error);

      setStatus('error');
      resetStatusSoon();
    }
  };

  const label =
    status === 'copied'
      ? 'Link copied'
      : status === 'error'
        ? 'Failed to copy link'
        : 'Copy a shareable link to this view';

  const title =
    status === 'copied'
      ? 'Link copied!'
      : status === 'error'
        ? 'Failed to copy link'
        : 'Share this view';

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={title}
      className={`theme-toggle ${className}`}
    >
      {status === 'copied' ? (
        <Check className="h-5 w-5 text-emerald-500" />
      ) : status === 'error' ? (
        <X className="h-5 w-5 text-red-500" />
      ) : (
        <Share className="h-5 w-5" />
      )}

      <span className="sr-only">{label}</span>
    </button>
  );
}
