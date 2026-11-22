// TCK — repository structure + custom element registration (spec §1.3).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDom } from './helpers/dom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('repository layout conforms to spec §1.3', () => {
  for (const f of [
    'components/app-store/app-store.js',
    'components/app-menu/app-menu.js',
    'components/shared/app-store-api.js',
    'components/shared/logic.js',
    'components/boilerplate/index.js',
    'model/app-store.model.json',           // declarative source of truth (structure)
    'sql/triggers/app_store_on_user_insert.sql',
    'sql/triggers/app_store_on_feature_insert.sql',
    'sql/010_features.sql',                 // REFERENCE DDL generated from the JSON
    'sql/011_prefs.sql',
    'sql/012_backfill_prefs.sql',           // one-shot migration
    'sql/020_features_v2.sql',
    'sql/README.md',
    'spec/app-store-spec.md',
    'README.md',
    'package.json',
  ]) {
    assert.ok(existsSync(join(root, f)), `file present: ${f}`);
  }
});

test('the blox register their custom elements and set window.appStore', async () => {
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
  assert.ok(customElements.get('app-menu'), '<app-menu> registered');
  assert.ok(customElements.get('app-store'), '<app-store> registered');
  assert.equal(window.appStore, appStore, 'window.appStore set');
});

test('the v1 model (JSON) does not contain the v2 columns (L3: Part 1 unchanged)', () => {
  const model = JSON.parse(readFileSync(join(root, 'model/app-store.model.json'), 'utf8'));
  const s = JSON.stringify(model);
  for (const col of ['npm_package', 'cdn_url', 'model_injected', 'sri']) {
    assert.ok(!s.includes(col), `the v1 model must not contain ${col}`);
  }
  // the JSON declares the 2 tables, the ACL, the mapping and the referenced triggers
  assert.ok(model.tables['app.features'] && model.tables['app.prefs']);
  assert.ok(Array.isArray(model.acl) && model.acl.length >= 2);
  assert.ok(Array.isArray(model.asset_mapping) && model.asset_mapping.length === 2);
  assert.equal(model.triggers.length, 2);
  for (const t of model.triggers) {
    assert.ok(existsSync(join(root, t.function_file)), `referenced trigger file present: ${t.function_file}`);
  }
  // the role_min column (§1.4.1) is in the model
  assert.ok(model.tables['app.features'].fields.role_min, 'role_min present');
  const s020 = readFileSync(join(root, 'sql/020_features_v2.sql'), 'utf8');
  for (const col of ['npm_package', 'cdn_url', 'sri', 'tag', 'model_injected']) {
    assert.ok(s020.includes(col), `020_features_v2.sql contient ${col}`);
  }
});
