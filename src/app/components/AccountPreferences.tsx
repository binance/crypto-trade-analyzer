import { Chevron } from '../icons/Chevron';
import { SettingsIcon } from '../icons/Settings';
import { Toggle } from './Toggle';
import type { PerExchangeSettings } from '../types';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { UserTierSelect } from './UserTierSelect';

/**
 * Renders the Account Preferences panel, allowing users to configure exchange-specific settings
 * such as trading tier, token fee discount, and view the effective taker fee.
 *
 * @param settings - Current per-exchange settings for the user.
 * @param prefsOpen - Whether the preferences panel is expanded.
 * @param userTiers - List of available user trading tiers.
 * @param defaultTier - Default trading tier to select if none is set.
 * @param supportsTokenDiscount - Whether the exchange supports token fee discounts.
 * @param onChangeSettings - Callback to update settings when a preference changes.
 * @param setPrefsOpen - State setter to toggle the preferences panel open/closed.
 *
 * @returns The Account Preferences React component.
 */
export function AccountPreferences({
  settings,
  prefsOpen,
  userTiers,
  defaultTier,
  supportsTokenDiscount,
  onChangeSettings,
  setPrefsOpen,
}: {
  settings?: PerExchangeSettings;
  prefsOpen: boolean;
  userTiers?: string[];
  defaultTier?: string;
  supportsTokenDiscount?: boolean;
  onChangeSettings: (p: Partial<PerExchangeSettings>) => void;
  setPrefsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): JSX.Element {
  const tokenDiscountOn = !!settings?.tokenDiscount;

  const storedPctStr = useMemo(
    () =>
      settings?.customFees != null ? String(Number((settings.customFees * 100).toFixed(6))) : '',
    [settings?.customFees]
  );

  // Draft state for the custom fee input field
  const [customDraft, setCustomDraft] = useState(storedPctStr);

  // Sync draft if stored value changes
  useEffect(() => {
    setCustomDraft(storedPctStr);
  }, [storedPctStr]);

  // Clamp a number to the range [0, 100]
  const setMaxAllowed = (n: number) => Math.max(0, Math.min(100, n));

  // Parse a percentage string (with optional % sign) into a number, or null if invalid
  const parsePercentString = (s: string): number | null => {
    const cleaned = s.replace(/\s|%/g, '').replace(',', '.');
    if (cleaned === '' || cleaned === '.' || cleaned === '-.' || cleaned === '-') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // Commit the draft value to settings, or clear if invalid/empty
  const commitDraft = () => {
    const pct = parsePercentString(customDraft);
    if (pct === null) {
      onChangeSettings({ customFees: undefined });
      setCustomDraft('');
      return;
    }
    const parsed = setMaxAllowed(pct);
    onChangeSettings({ customFees: parsed / 100 });
    setCustomDraft(String(Number(parsed.toFixed(6))));
  };

  return (
    <div className="px-4 pt-3 pb-4 border-t border-base">
      <div className="rounded-xl border overflow-hidden border-base surface-subtle">
        {/* Header */}
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          aria-expanded={prefsOpen}
          className="card-header w-full flex items-center justify-between px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
        >
          <span className="inline-flex items-center gap-2">
            <SettingsIcon className="w-4 h-4" />
            Account Preferences
          </span>
          <Chevron open={prefsOpen} />
        </button>

        {prefsOpen && (
          <div className="px-3 pb-3 pt-2 space-y-3">
            {/* User tier */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium">User Tier</div>
                <div className="text-[11px] text-muted">Choose your trading tier</div>
              </div>

              <UserTierSelect
                value={settings?.userTier ?? defaultTier ?? userTiers?.[0] ?? ''}
                options={userTiers ?? (defaultTier ? [defaultTier] : [])}
                onChange={(v) => onChangeSettings({ userTier: v })}
                className=""
                widthClass="w-36"
              />
            </div>

            {/* Token discount */}
            {supportsTokenDiscount && (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium">Token Fee Discount</div>
                  <div className="text-[11px] text-muted">
                    Pay fees with the exchange’s token for a reduced rate.
                  </div>
                </div>

                <Toggle
                  className="shrink-0 self-start mt-0.5"
                  checked={tokenDiscountOn}
                  onChange={(val) => {
                    if (val) {
                      onChangeSettings({ customFees: undefined });
                      setCustomDraft('');
                    }
                    onChangeSettings({ tokenDiscount: val });
                  }}
                />
              </div>
            )}

            {/* Custom taker fee (percentage) */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium">Custom Taker Fee</div>
                <div className="text-[11px] text-muted">
                  Override the taker fee as a percentage. Leave empty to use tier/discount.
                </div>
              </div>

              <div className="relative shrink-0 self-start">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 0.1"
                  className="field field-sm w-28 pr-10 text-right tabular"
                  value={customDraft}
                  maxLength={10}
                  onChange={(e) => {
                    const raw = e.target.value;

                    // allow only digits, spaces, comma/period
                    if (!/^[\d\s.,%]*$/.test(raw)) return;

                    // If user starts entering a custom fee while token discount is on, turn it off
                    if (tokenDiscountOn && raw.trim() !== '')
                      onChangeSettings({ tokenDiscount: false });

                    // Check if user is typing a trailing decimal
                    const cleaned = raw.replace(/\s|%/g, '').replace(',', '.');
                    const endsWithDot = cleaned.endsWith('.');

                    // If trailing dot, clamp only if integer part already exceeds 100
                    if (endsWithDot) {
                      const before = cleaned.slice(0, -1);
                      const n = Number(before);
                      if (Number.isFinite(n) && n > 100) {
                        setCustomDraft('100.');
                        onChangeSettings({ customFees: 1 });
                      } else {
                        setCustomDraft(raw);
                      }
                      return;
                    }

                    // Normal path: parse and clamp
                    const pct = parsePercentString(raw);
                    if (pct === null) {
                      setCustomDraft(raw);
                      onChangeSettings({ customFees: undefined });
                      return;
                    }

                    const parsed = setMaxAllowed(pct);
                    const normalized = String(Number(parsed.toFixed(6)));

                    if (parsed !== pct) setCustomDraft(normalized);
                    else setCustomDraft(raw);

                    onChangeSettings({ customFees: parsed / 100 });
                  }}
                  onBlur={commitDraft}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                {/* % suffix */}
                <span
                  aria-hidden
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-xs text-muted"
                >
                  %
                </span>
                {/* Clear button */}
                {(customDraft !== '' || storedPctStr !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDraft('');
                      onChangeSettings({ customFees: undefined });
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 btn-ghost-muted rounded-full h-5 w-5 grid place-items-center"
                    title="Clear custom fee"
                    aria-label="Clear custom fee"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
