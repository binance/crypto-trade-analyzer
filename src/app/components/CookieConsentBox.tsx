import { useEffect, useRef, useState, type JSX } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  doNotTrackEnabled,
  getStoredConsent,
  setStoredConsent,
  syncGAConsent,
} from '../../utils/analytics';

/**
 * Displays a cookie consent dialog to the user, allowing them to accept or reject
 * the use of cookies for analytics purposes. Handles Do Not Track (DNT) settings,
 * persists user consent, and synchronizes consent state with Google Analytics.
 *
 * @param learnMoreHref - Optional URL for users to learn more about privacy and cookies.
 * @returns The cookie consent dialog JSX element, or null if consent is not needed or DNT is enabled.
 */
export function CookieConsentBox({
  learnMoreHref,
}: {
  learnMoreHref?: string;
}): JSX.Element | null {
  const [dnt, setDnt] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const acceptBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dnt = doNotTrackEnabled();
    setDnt(dnt);
    const stored = getStoredConsent();

    if (dnt) {
      if (stored !== 'denied') setStoredConsent('denied');
      syncGAConsent();
      setShouldShow(false);
      return;
    }

    if (stored) {
      syncGAConsent();
      setShouldShow(false);
    } else {
      setShouldShow(true);
      const showTimer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(showTimer);
    }
  }, []);

  useEffect(() => {
    if (isVisible && !isAnimatingOut) {
      const focusTimer = setTimeout(() => acceptBtnRef.current?.focus(), 200);
      return () => clearTimeout(focusTimer);
    }
  }, [isVisible, isAnimatingOut]);

  const hideDialog = (callback: () => void) => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      callback();
      setIsVisible(false);
      setShouldShow(false);
      setIsAnimatingOut(false);
    }, 300);
  };

  const onAccept = () => {
    hideDialog(() => {
      setStoredConsent('granted');
      syncGAConsent();
    });
  };

  const onReject = () => {
    hideDialog(() => {
      setStoredConsent('denied');
      syncGAConsent();
    });
  };

  if (dnt || !shouldShow) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className={`cookie-consent ${isVisible ? 'cookie-consent--visible' : ''} ${isAnimatingOut ? 'cookie-consent--hiding' : ''}`}
    >
      <div className="cookie-consent__body">
        <div className="cookie-consent__header">
          <BarChart3 className="cookie-consent__icon" aria-hidden /> {/* was <Shield /> */}
          <div className="cookie-consent__title">We value your privacy</div>
        </div>

        <div className="cookie-consent__content">
          <p className="cookie-consent__text">
            We use cookies to enhance your experience and analyze site usage. These help us
            understand how you interact with our platform and improve our services. We do not track
            or store any sensitive personal data. Analytics are used in aggregate to improve the
            app.
          </p>

          {learnMoreHref && (
            <a
              href={learnMoreHref}
              target="_blank"
              rel="noreferrer"
              className="cookie-consent__link"
            >
              Privacy &amp; cookies
            </a>
          )}

          <div className="cookie-consent__actions">
            <button
              type="button"
              onClick={onReject}
              className="cookie-consent__btn cookie-consent__btn--reject"
            >
              Reject
            </button>

            <button
              ref={acceptBtnRef}
              type="button"
              onClick={onAccept}
              className="cookie-consent__btn cookie-consent__btn--accept"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
