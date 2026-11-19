// Clock times (10:30, or 10:30 am) in the format the system is set to, for the
// desktop and mobile apps. Each app finds out whether the system uses a
// 12-hour clock and passes that in; dates keep the app's own style.

/** Does this locale's default clock run 12-hour (h11/h12) rather than 24-hour? */
export function hour12ForLocale(locale) {
  try {
    const cycle = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    if (cycle) return cycle === 'h11' || cycle === 'h12';
    return /[ap]/i.test(new Date(2020, 0, 1, 15).toLocaleTimeString(locale || undefined, { hour: 'numeric' }));
  } catch {
    return false;
  }
}

/**
 * Windows' short time pattern (Region settings, HKCU\Control Panel\International
 * sShortTime, e.g. "h:mm tt" or "HH:mm"): true for 12-hour, false for 24-hour,
 * null when it can't tell.
 */
export function hour12FromPattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const p = pattern.replace(/'[^']*'/g, ''); // quoted literals aren't hours
  if (/H/.test(p)) return false;
  if (/h/.test(p)) return true;
  return null;
}

/** Options for toLocale*String: the hour and minute, 12- or 24-hour as the system is. */
export function timeOptions(hour12) {
  return hour12 ? { hour: 'numeric', minute: '2-digit', hour12: true } : { hour: '2-digit', minute: '2-digit', hour12: false };
}

/** A time of day: "15:05" or "3:05 pm". */
export function clockTime(ts, hour12, locale = 'en-GB') {
  return new Date(ts).toLocaleTimeString(locale, timeOptions(hour12));
}
