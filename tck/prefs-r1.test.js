// TCK — form R1 of the prefs PATCHes (§1.5): generic parsing of the serialized key +
// read-modify-write (the PEP replaces the `prefs` jsonb column — observed live 21/11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefsColumn, prefsPatchBody, togglePatch, configPatch } from '../components/shared/logic.js';

test('prefsColumn: finds the jsonb column whatever the serialization prefix', () => {
  assert.deepEqual(prefsColumn({ prefs: { a: { enabled: true } } }), { a: { enabled: true } });
  assert.deepEqual(prefsColumn({ 'prefs:prefs': { a: {} } }), { a: {} });
  assert.deepEqual(prefsColumn({ 'app_prefs:prefs': { a: {} }, '@id': 'http://x/prefs/1' }), { a: {} });
  assert.deepEqual(prefsColumn({ '@id': 'http://x/prefs/1' }), {});
  assert.deepEqual(prefsColumn(null), {});
  assert.deepEqual(prefsColumn({ prefs: 'not-an-object' }), {});
});

test('prefsPatchBody: read-modify-write — merge by slug with the current state', () => {
  // without current state → the patch alone (form R1)
  assert.deepEqual(prefsPatchBody(togglePatch('building-map', false)), { prefs: { 'building-map': { enabled: false } } });
  const current = { 'building-map': { enabled: true, config: { zoom: 3 } }, tickets: { enabled: true } };
  // toggle building-map → keeps its config, preserves tickets (the PEP replaces the column)
  assert.deepEqual(prefsPatchBody(togglePatch('building-map', false), current), {
    prefs: { 'building-map': { enabled: false, config: { zoom: 3 } }, tickets: { enabled: true } },
  });
  // config only → keeps the existing enabled
  assert.deepEqual(prefsPatchBody(configPatch('building-map', { zoom: 5 }), current), {
    prefs: { 'building-map': { enabled: true, config: { zoom: 5 } }, tickets: { enabled: true } },
  });
});
