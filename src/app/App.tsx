import { lazy, Suspense, type JSX } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useTermsConsent } from './hooks/useTermsConsent';
import HomePage from './pages/HomePage';

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
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route
          path="/"
          element={
            accepted ? (
              <HomePage />
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
