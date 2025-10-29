import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { TermsConsentContext } from '../hooks/useTermsConsent';
import { TERMS_KEY } from '../../utils/constants';

/**
 * Provides a context for managing user consent to terms.
 *
 * This provider tracks whether the user has accepted the terms, persists the acceptance state in localStorage,
 * and updates the state in response to changes in localStorage (e.g., across browser tabs).
 *
 * @remarks
 * - The `accepted` state is initialized from localStorage and updated on storage events.
 * - The `accept` function sets the acceptance in localStorage and updates the state.
 * - The context value includes both the acceptance state and the accept function.
 */
export function TermsConsentProvider({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(TERMS_KEY) === 'true';
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TERMS_KEY) setAccepted(e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const accept = () => {
    localStorage.setItem(TERMS_KEY, 'true');
    setAccepted(true);
  };

  const value = useMemo(() => ({ accepted, accept }), [accepted]);
  return <TermsConsentContext.Provider value={value}>{children}</TermsConsentContext.Provider>;
}
