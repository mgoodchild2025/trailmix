// Clock times in the phone's own format (Settings: 24-hour time on or off).
// Asked once, and again whenever the app comes back to the front, since the
// setting can change while it's in the background.
import { AppState } from 'react-native';
import { getCalendars } from 'expo-localization';
import { clockTime, hour12ForLocale, timeOptions } from '../../../shared/clock.js';

let hour12 = null;

export function systemHour12() {
  if (hour12 === null) {
    let uses24 = null;
    try {
      uses24 = getCalendars()[0]?.uses24hourClock;
    } catch {
      uses24 = null;
    }
    hour12 = typeof uses24 === 'boolean' ? !uses24 : hour12ForLocale();
  }
  return hour12;
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') hour12 = null;
});

/** A time of day: "15:05" or "3:05 pm". */
export const fmtTime = (ts) => clockTime(ts, systemHour12());

/** The hour and minute options for toLocaleString, in the phone's format. */
export const clockOptions = () => timeOptions(systemHour12());
