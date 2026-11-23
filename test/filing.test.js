import test from 'node:test';
import assert from 'node:assert/strict';
import { filedRecord, pickSuggestion, suggestQueries } from '../shared/filing.js';

test('searches use the distinctive words of a title, not "meeting" or "Q3"', () => {
  assert.deepEqual(suggestQueries('Northfield Dental — Q3 service review'), ['northfield', 'dental']);
  assert.deepEqual(suggestQueries('Weekly team meeting'), []);
  assert.deepEqual(suggestQueries('Call with Acme Plumbing about the firewall'), ['plumbing', 'firewall', 'acme']);
  assert.deepEqual(suggestQueries(''), []);
});

test('the suggestion is the client whose whole name is in the title', () => {
  const results = [
    { type: 'company', id: '1', name: 'Northfield Dental', detail: 'Client' },
    { type: 'company', id: '2', name: 'Northfield Dental Leeds Ltd', detail: 'Client' },
    { type: 'company', id: '3', name: 'Dental Supplies Inc', detail: 'Prospect' },
    { type: 'lead', id: '4', name: 'Acme Plumbing', detail: 'Lead · Jo Smith' },
  ];
  assert.equal(pickSuggestion('Northfield Dental — Q3 service review', results).id, '1');
  assert.equal(pickSuggestion('Northfield Dental Leeds backup issues', results).id, '2');
  assert.equal(pickSuggestion('Intro call: Acme Plumbing', results).id, '4');
  assert.equal(pickSuggestion('Dental conference debrief', results), null);
  assert.equal(pickSuggestion('Anything', []), null);
});

test('a nickname in brackets counts when the title uses it', () => {
  const results = [{ type: 'company', id: '9', name: 'Caravaggio Real Estate (CRE)', detail: 'Client' }];
  assert.equal(pickSuggestion('CRE monthly check-in', results).id, '9');
  assert.equal(pickSuggestion('Caravaggio Real Estate renewal', results).id, '9');
  assert.equal(pickSuggestion('Real estate market chat', results), null);
});

test('a filing is remembered with the client and where it shows in CG Core', () => {
  const r = filedRecord({ activityId: 'a1', target: { type: 'company', id: 'c1', name: 'Northfield Dental' }, url: 'https://core/x', filedAt: '2026-11-23T15:00:00Z' }, false);
  assert.deepEqual(r, { type: 'company', id: 'c1', name: 'Northfield Dental', activityId: 'a1', url: 'https://core/x', at: Date.parse('2026-11-23T15:00:00Z'), includeTranscript: false });
});
