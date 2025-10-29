import { useMemo, useEffect, useState, type JSX } from 'react';
import type { TimeUnitStyle } from '../types';

/**
 * Displays a human-readable relative time label (e.g., "just now", "5 min ago") for a given date.
 * Optionally shows the exact timestamp and supports UTC formatting.
 *
 * @param date - The target date to compare against the current time. Can be a Date object, number (epoch ms), or ISO string.
 * @param showTimestamp - If true, displays the exact time alongside the relative label. Defaults to false.
 * @param className - Optional CSS class for styling the component.
 * @param utc - If true, formats the timestamp in UTC. Defaults to false.
 * @param label - Optional label prefix (e.g., "Updated"). Defaults to "Updated".
 * @param unitStyle - Style for the relative time unit. Can be 'full', 'abbr', 'short', or 'narrow'. Defaults to 'abbr'.
 *
 * @returns A React element displaying the relative time and optional timestamp.
 */
export function TimestampDetails({
  date,
  showTimestamp = false,
  className,
  utc = false,
  label = 'Updated',
  unitStyle = 'abbr',
}: {
  date: Date | number | string;
  showTimestamp?: boolean;
  className?: string;
  utc?: boolean;
  label?: string;
  unitStyle?: TimeUnitStyle;
}): JSX.Element {
  const targetMs = useMemo(() => {
    const d = typeof date === 'number' || typeof date === 'string' ? new Date(date) : date;
    const t = d?.getTime?.();
    return Number.isFinite(t) ? (t as number) : NaN;
  }, [date]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(targetMs)) return;
    const age = now - targetMs;
    const delay = age < 60000 ? 1000 : age < 3600000 ? 15000 : 60000;
    const id = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(id);
  }, [now, targetMs]);

  if (!Number.isFinite(targetMs)) return <span className={className}>{label} —</span>;

  const age = now - targetMs;

  // Decide unit & value
  let value: number;
  let unit: 'second' | 'minute' | 'hour' | 'day';
  if (age < 60000) {
    value = Math.round(age / 1000);
    unit = 'second';
  } else if (age < 3600000) {
    value = Math.round(age / 60000);
    unit = 'minute';
  } else if (age < 86400000) {
    value = Math.round(age / 3600000);
    unit = 'hour';
  } else {
    value = Math.round(age / 86400000);
    unit = 'day';
  }

  const rel = (() => {
    // Keep ultra-recent special case
    if (age < 2000) return 'just now';

    if (unitStyle === 'abbr') {
      // strict abbreviations requested: s, min, h, d
      const suffix =
        unit === 'second' ? 's' : unit === 'minute' ? 'min' : unit === 'hour' ? 'h' : 'd';
      // compact like 5s / 3min / 2h / 1d
      const core = `${value}${suffix}`;
      return `${core} ago`;
    }

    // Use Intl for other styles
    const style = unitStyle === 'full' ? undefined : unitStyle;
    const rtf = new Intl.RelativeTimeFormat(undefined, {
      numeric: 'auto',
      style: style as Intl.RelativeTimeFormatStyle | undefined,
    });

    return rtf.format(-value, unit);
  })();

  const toneClass =
    age < 2000 ? 'tone-0' : age < 60000 ? 'tone-1' : age < 3600000 ? 'tone-2' : 'tone-3';

  const dt = new Date(targetMs);
  const tsISO = dt.toISOString();
  const tsHMS = dt.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: utc ? 'UTC' : undefined,
  });

  // Local timezone offset label, e.g. "UTC+03:00"
  const offsetMinutes = -dt.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const localTzLabel = `UTC${sign}${hh}:${mm}`;

  return (
    <time dateTime={tsISO} title={`${label} at ${tsISO}`} className={className} aria-live="polite">
      {label} <span className={toneClass}>{rel}</span>
      {showTimestamp && (
        <span className="text-muted">
          {' '}
          ({tsHMS} {utc ? 'UTC' : localTzLabel})
        </span>
      )}
    </time>
  );
}
