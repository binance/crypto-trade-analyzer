/**
 * Application entry point that sets up the React rendering tree.
 *
 * This file:
 * - Creates the root React element in the DOM
 * - Wraps the application in StrictMode for additional development checks
 * - Implements an ErrorBoundary to gracefully handle runtime errors
 * - Renders the main App component
 *
 * The application is mounted to the DOM element with id 'root', which should be
 * defined in the HTML template.
 *
 * @module main
 */

import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { TermsConsentProvider } from './app/providers/TermsConsentProvider';
import './index.css';

/**
 * A React error boundary component that catches JavaScript errors in its child component tree.
 * Prevents the entire application from crashing and displays a fallback UI when errors occur.
 *
 * @see {@link https://reactjs.org/docs/error-boundaries.html React Error Boundaries Documentation}
 *
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <ComponentThatMightError />
 * </ErrorBoundary>
 * ```
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1rem' }}>
          <h1>Something went wrong.</h1>
          <p>Please reload the page and try again.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <TermsConsentProvider>
          <App />
        </TermsConsentProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
