// TCK — forme R1 des PATCH prefs (§1.5) : parsing générique de la clé sérialisée +
// read-modify-write (le PEP remplace la colonne jsonb `prefs` — constaté live 21/11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefsColumn, prefsPatchBody, togglePatch, configPatch } from '../components/shared/logic.js';

test('prefsColumn : retrouve la colonne jsonb quel que soit le préfixe de sérialisation', () => {
  assert.deepEqual(prefsColumn({ prefs: { a: { enabled: true } } }), { a: { enabled: true } });
  assert.deepEqual(prefsColumn({ 'prefs:prefs': { a: {} } }), { a: {} });
  assert.deepEqual(prefsColumn({ 'app_prefs:prefs': { a: {} }, '@id': 'http://x/prefs/1' }), { a: {} });
  assert.deepEqual(prefsColumn({ '@id': 'http://x/prefs/1' }), {});
  assert.deepEqual(prefsColumn(null), {});
  assert.deepEqual(prefsColumn({ prefs: 'pas-un-objet' }), {});
});

test('prefsPatchBody : read-modify-write — merge par slug avec l\'état courant', () => {
  // sans état courant → le patch seul (forme R1)
  assert.deepEqual(prefsPatchBody(togglePatch('building-map', false)), { prefs: { 'building-map': { enabled: false } } });
  const current = { 'building-map': { enabled: true, config: { zoom: 3 } }, tickets: { enabled: true } };
  // toggle building-map → garde sa config, conserve tickets (le PEP remplace la colonne)
  assert.deepEqual(prefsPatchBody(togglePatch('building-map', false), current), {
    prefs: { 'building-map': { enabled: false, config: { zoom: 3 } }, tickets: { enabled: true } },
  });
  // config seule → garde enabled existant
  assert.deepEqual(prefsPatchBody(configPatch('building-map', { zoom: 5 }), current), {
    prefs: { 'building-map': { enabled: true, config: { zoom: 5 } }, tickets: { enabled: true } },
  });
});
