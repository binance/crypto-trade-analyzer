import { createContext, useContext } from 'react';

/**
 * React context carrying the Terms & Conditions consent state and an action to accept.
 *
 * Provides:
 * - accepted: boolean — whether the user has accepted the current terms.
 * - accept(): void — marks the terms as accepted and updates state/persistence.
 *
 * The value is `undefined` when consumed outside its provider. Prefer using the
 * `useTermsConsent()` hook to access this context safely.
 *
 */
export const TermsConsentContext = createContext<
  { accepted: boolean; accept: () => void } | undefined
>(undefined);

/**
 * React hook that returns the Terms & Conditions consent context value from the nearest provider.
 *
 * This hook must be used within a component tree wrapped by `TermsConsentProvider`. If it is
 * called outside of a provider, it will throw an error to help detect incorrect usage early.
 *
 * @returns The current terms consent context value, including state and actions provided by the context.
 * @throws {Error} Thrown when the hook is used outside of a `TermsConsentProvider`.
 *
 */
export function useTermsConsent() {
  const ctx = useContext(TermsConsentContext);
  if (!ctx) throw new Error('useTermsConsent must be used within TermsConsentProvider');
  return ctx;
}
