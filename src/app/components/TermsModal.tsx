import { useEffect, useRef, useState, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useTermsConsent } from '../hooks/useTermsConsent';
import termsMd from '../../../TERMS_OF_USE.md?raw';
import { Link } from 'react-router-dom';

/**
 * A modal dialog that displays the Terms of Service and requires users to scroll to the end
 * before accepting. The modal cannot be dismissed until the user accepts the terms.
 *
 * @returns A modal dialog component or null if terms are already accepted
 */
export default function TermsModal(): JSX.Element | null {
  // Terms of Service content
  const { accepted, accept } = useTermsConsent();
  const open = !accepted;

  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus handling + prevent ESC dismiss
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus();
    };
  }, [open]);

  // Scroll-to-end detection
  const recompute = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 12;
    const reached = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    setAtEnd(reached);
  };

  // Recompute on open, resize, scroll, or content resize
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(recompute);

    // Recompute on window resize
    const onResize = () => recompute();
    window.addEventListener('resize', onResize, { passive: true });

    // Recompute whenever the scroll area's size or content changes
    const el = scrollRef.current;
    const ro = el ? new ResizeObserver(recompute) : null;
    if (el) {
      ro?.observe(el);
      if (el.firstElementChild) ro?.observe(el.firstElementChild as Element);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`
          w-full h-[100svh] sm:h-auto sm:max-h-[85dvh]
          bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50
          sm:mx-4 sm:w-full sm:max-w-2xl sm:rounded-2xl
          border border-zinc-200 dark:border-white/10 shadow-2xl
          flex flex-col outline-none ring-0
        `}
      >
        {/* Scrollable content area */}
        <div
          ref={scrollRef}
          onScroll={recompute}
          className="
            flex-1 min-h-0 overflow-y-auto overscroll-contain
            px-4 sm:px-5 py-4
            prose prose-zinc dark:prose-invert prose-sm max-w-none
            will-change-transform
          "
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={{
              a({ href = '', children, ...props }) {
                const isInternal = href.startsWith('/') || href.startsWith(window.location.origin);
                if (isInternal) {
                  return (
                    <Link to={href.replace(window.location.origin, '')} {...props}>
                      {children}
                    </Link>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow external"
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {termsMd}
          </ReactMarkdown>
        </div>

        {/* Footer */}
        <div
          className="px-4 sm:px-5 py-3 sm:py-4 border-t border-black/5 dark:border-white/5 flex items-center justify-end sm:justify-between gap-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        >
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 hidden sm:block">
            Scroll to the end to accept Terms of Use.
          </p>
          {!atEnd && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 sm:hidden w-fit text-left mt-2">
              Scroll to the end to accept Terms of Use.
            </p>
          )}
          <button
            type="button"
            disabled={!atEnd}
            onClick={accept}
            className={`
              inline-flex items-center justify-center rounded-xl px-6 py-2 text-sm font-medium
              ring-1 ring-zinc-300 bg-zinc-100 text-zinc-900 hover:bg-zinc-200
              dark:ring-white/15 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            aria-disabled={!atEnd}
            aria-label="Accept Terms of Use"
            title={!atEnd ? 'Scroll to the end to enable' : 'Accept Terms of Use'}
          >
            I Agree
          </button>
        </div>
      </div>
    </div>
  );
}
