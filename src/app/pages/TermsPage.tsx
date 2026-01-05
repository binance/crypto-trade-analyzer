import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { JSX } from 'react';

import termsMd from '../../../PRODUCT_TERMS.md?raw';
import { Link } from 'react-router-dom';

/**
 * Renders the Product Terms page.
 *
 * This component parses the raw terms content using the `marked` library
 * and displays it as HTML within a styled article element.
 *
 * @returns {JSX.Element} The Product Terms page component.
 */
export default function TermsPage(): JSX.Element {
  return (
    <article className="prose prose-invert max-w-3xl mx-auto px-4 py-8">
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
              <a href={href} target="_blank" rel="noopener noreferrer nofollow external" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {termsMd}
      </ReactMarkdown>
    </article>
  );
}
