// TCK — structure du dépôt + enregistrement des custom elements (spec §1.3).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDom } from './helpers/dom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('layout du dépôt conforme à la spec §1.3', () => {
  for (const f of [
    'components/app-store/app-store.js',
    'components/app-menu/app-menu.js',
    'components/shared/app-store-api.js',
    'components/shared/logic.js',
    'components/boilerplate/index.js',
    'model/app-store.model.json',           // source de vérité déclarative (structure)
    'sql/triggers/app_store_on_user_insert.sql',
    'sql/triggers/app_store_on_feature_insert.sql',
    'sql/010_features.sql',                 // DDL de référence généré depuis le JSON
    'sql/011_prefs.sql',
    'sql/012_backfill_prefs.sql',           // migration one-shot
    'sql/020_features_v2.sql',
    'sql/README.md',
    'spec/app-store-spec.md',
    'README.md',
    'package.json',
  ]) {
    assert.ok(existsSync(join(root, f)), `fichier présent : ${f}`);
  }
});

test('les blox enregistrent leurs custom elements et posent window.appStore', async () => {
  const window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [] };
  window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }) };
  const { appStore } = await import('../components/shared/app-store-api.js');
  await import('../components/app-menu/app-menu.js');
  await import('../components/app-store/app-store.js');
  assert.equal(typeof appStore.isEnabled, 'function');
  assert.equal(typeof appStore.mePrefsIri, 'function');
  assert.equal(typeof appStore.patchPrefs, 'function');
  assert.equal(typeof appStore.installRouteGuard, 'function');
  assert.equal(typeof appStore.AppStoreGuardMixin, 'function');
  assert.ok(customElements.get('app-menu'), '<app-menu> enregistré');
  assert.ok(customElements.get('app-store'), '<app-store> enregistré');
  assert.equal(window.appStore, appStore, 'window.appStore posé');
});

test('le modèle v1 (JSON) ne contient pas les colonnes v2 (L3 : Partie 1 inchangée)', () => {
  const model = JSON.parse(readFileSync(join(root, 'model/app-store.model.json'), 'utf8'));
  const s = JSON.stringify(model);
  for (const col of ['npm_package', 'cdn_url', 'model_injected', 'sri']) {
    assert.ok(!s.includes(col), `le modèle v1 ne doit pas contenir ${col}`);
  }
  // le JSON déclare bien les 2 tables, l'ACL, le mapping et les triggers référencés
  assert.ok(model.tables['app.features'] && model.tables['app.prefs']);
  assert.ok(Array.isArray(model.acl) && model.acl.length >= 2);
  assert.ok(Array.isArray(model.asset_mapping) && model.asset_mapping.length === 2);
  assert.equal(model.triggers.length, 2);
  for (const t of model.triggers) {
    assert.ok(existsSync(join(root, t.function_file)), `fichier trigger référencé présent : ${t.function_file}`);
  }
  // la colonne role_min (§1.4.1) est dans le modèle
  assert.ok(model.tables['app.features'].fields.role_min, 'role_min présent');
  const s020 = readFileSync(join(root, 'sql/020_features_v2.sql'), 'utf8');
  for (const col of ['npm_package', 'cdn_url', 'sri', 'tag', 'model_injected']) {
    assert.ok(s020.includes(col), `020_features_v2.sql contient ${col}`);
  }
});
