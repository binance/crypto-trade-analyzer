import { lazy, Suspense, type JSX, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useTermsConsent } from './hooks/useTermsConsent';
import HomePage from './pages/HomePage';
import { MarketSignals } from '../core/services/market-signals';
import type { OrderSide } from '../core/interfaces/order-book';

const TermsPage = lazy(() => import('./pages/TermsPage'));
const TermsModal = lazy(() => import('../app/components/TermsModal'));

/**
 * Root layout component that provides the base structure for the application.
 *
 * @returns A JSX element containing the root layout structure with a main content area
 * that will render the current route's component.
 */
function RootLayout(): JSX.Element {
  return (
    <div className="min-h-dvh flex flex-col">
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Main application component that handles routing and terms consent flow.
 *
 * @returns The root application component with routing configuration.
 *
 */
export default function App() {
  const { accepted } = useTermsConsent();
  const [initialSide, setInitialSide] = useState<OrderSide | null>(null);

  // Decide initial order side before rendering the homepage
  useEffect(() => {
    if (!accepted) {
      setInitialSide(null);
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    (async () => {
      const sentimentPromise = (async (): Promise<OrderSide> => {
        try {
          const signals = new MarketSignals();
          return await signals.getOrderSideFromMarketSentiment(false);
        } catch (err) {
          console.warn('getOrderSideFromMarketSentiment() failed, falling back to buy', err);
          return 'buy';
        }
      })();

      const timeoutPromise = new Promise<OrderSide>((resolve) => {
        timeoutId = window.setTimeout(() => resolve('buy'), 800);
      });

      const resolvedSide = await Promise.race([sentimentPromise, timeoutPromise]);
      if (cancelled) return;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      setInitialSide(resolvedSide);
    })();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [accepted]);

  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route
          path="/"
          element={
            accepted ? (
              initialSide ? (
                <HomePage initialSide={initialSide} />
              ) : null
            ) : (
              <Suspense fallback={null}>
                <TermsModal />
              </Suspense>
            )
          }
        />
        <Route
          path="/terms"
          element={
            <Suspense fallback={null}>
              <TermsPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
