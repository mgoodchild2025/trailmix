import test from 'node:test';
import assert from 'node:assert/strict';
import { clockTime, hour12ForLocale, hour12FromPattern, timeOptions } from '../shared/clock.js';

const at = new Date(2026, 10, 19, 15, 5);

test('a 24-hour system shows 15:05, a 12-hour one 3:05 pm', () => {
  assert.equal(clockTime(at, false), '15:05');
  assert.equal(clockTime(at, true), '3:05 pm');
  assert.equal(clockTime(new Date(2026, 10, 19, 9, 0), false), '09:00');
  assert.equal(clockTime(new Date(2026, 10, 19, 0, 30), true), '12:30 am');
});

test('dates keep their style; only the time follows the system', () => {
  const opts = (h12) => ({ weekday: 'short', day: 'numeric', month: 'short', ...timeOptions(h12) });
  assert.equal(at.toLocaleString('en-GB', opts(false)), 'Thu 19 Nov, 15:05');
  assert.equal(at.toLocaleString('en-GB', opts(true)), 'Thu 19 Nov, 3:05 pm');
});

test("Windows' short time pattern says which clock it is", () => {
  assert.equal(hour12FromPattern('h:mm tt'), true);
  assert.equal(hour12FromPattern('hh:mm tt'), true);
  assert.equal(hour12FromPattern('HH:mm'), false);
  assert.equal(hour12FromPattern('H:mm'), false);
  assert.equal(hour12FromPattern("HH 'h' mm"), false, 'a quoted h is text, not the hour');
  assert.equal(hour12FromPattern(''), null);
  assert.equal(hour12FromPattern(undefined), null);
});

test("a region's default clock", () => {
  assert.equal(hour12ForLocale('en-US'), true);
  assert.equal(hour12ForLocale('en-CA'), true);
  assert.equal(hour12ForLocale('en-GB'), false);
  assert.equal(hour12ForLocale('fr-FR'), false);
  assert.equal(typeof hour12ForLocale(undefined), 'boolean');
  assert.equal(hour12ForLocale('not a locale!'), false);
});
