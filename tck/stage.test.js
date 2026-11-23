// TCK — v0.5 two-stage store (spec v0.5 §1.4.3, J8): stage discriminant, install branch
// (code = SRI unchanged, declarative = document hash verified), boot route merge, CA-A8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeclarative, isInstalled, declarativeRoutes, installPatch, installedEntry, isDistant,
} from '../components/shared/logic.js';
import { installFeature, DocumentHashMismatchError } from '../components/shared/install.js';
import { documentHash, canonicalJson, hashableDoc } from '../components/shared/hash.js';

const CODE = { slug: 'tickets', stage: 'code', cdn_url: 'https://cdn.test/tickets.js', tag: 'ticket-board', sri: 'sha384-bundle', version: '1.2.0', route: '/tickets', role_min: 'manager', default_enabled: true };
const DECL = {
  slug: 'tickets-view', stage: 'declarative', document_iri: 'https://pod.test/components/tickets-list/1',
  sri: 'sha384-doc', route: '/tickets-view', role_min: 'all', default_enabled: false, component: 'cmp-runtime', in_menu: true,
};
const DOC = { '@id': 'https://pod.test/components/tickets-list/1', '@type': 'cmp:ListComponent', 'cmp:source': 'https://pod.test/tickets/' };

test('stage helpers: isDeclarative / isDistant stay orthogonal', () => {
  assert.equal(isDeclarative(DECL), true);
  assert.equal(isDeclarative(CODE), false);
  assert.equal(isDistant(CODE), true);
  assert.equal(isDistant(DECL), false); // no cdn_url+tag → the SRI loader path never applies
});

test('CA-A8 — code stage isInstalled/isDistant logic unchanged (distant needs installed_sri)', () => {
  assert.equal(isInstalled(CODE, {}), false);
  assert.equal(isInstalled(CODE, { tickets: { installed_version: '1.2.0', installed_sri: 'sha384-bundle' } }), true);
  assert.equal(isInstalled({ slug: 'packaged' }, {}), true); // packaged v1 always installed
});

test('declarative: installed only when the document hash was recorded in prefs', () => {
  assert.equal(isInstalled(DECL, {}), false);
  assert.equal(isInstalled(DECL, { 'tickets-view': { installed_version: DECL.document_iri, installed_sri: 'sha384-doc' } }), true);
});

test('hash: canonical, @id excluded → same content, different @id, same hash', async () => {
  const h1 = await documentHash({ ...DOC, '@id': 'https://pod.test/components/x/1' });
  const h2 = await documentHash({ ...DOC, '@id': 'https://pod.test/components/x/2' });
  assert.equal(h1, h2);
  const h3 = await documentHash({ ...DOC, 'cmp:pageSize': 50 });
  assert.notEqual(h1, h3);
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.deepEqual(hashableDoc({ '@id': 'x', a: 1 }), { a: 1 });
});

test('installFeature — declarative branch: verifies document hash BEFORE recording prefs', async () => {
  const hash = await documentHash(DOC);
  const feature = { ...DECL, sri: hash };
  const calls = [];
  const appStoreApi = { patchPrefs: async (p) => { calls.push(p); } };
  const fetchFn = async () => ({ ok: true, json: async () => DOC });
  const r = await installFeature(appStoreApi, feature, { fetchFn });
  assert.equal(r.installed, true);
  assert.equal(r.version, DECL.document_iri);
  assert.equal(r.sri, hash);
  assert.deepEqual(calls[0], installPatch('tickets-view', DECL.document_iri, hash));
  // tampered document → refusal, nothing recorded
  calls.length = 0;
  const badFetch = async () => ({ ok: true, json: async () => ({ ...DOC, 'cmp:source': 'https://evil/' }) });
  await assert.rejects(() => installFeature(appStoreApi, feature, { fetchFn: badFetch }), DocumentHashMismatchError);
  assert.equal(calls.length, 0);
});

test('installFeature — code stage path untouched (packaged toggle, no hash involved)', async () => {
  const calls = [];
  const appStoreApi = { patchPrefs: async (p) => { calls.push(p); } };
  const packaged = { slug: 'dashboard', component: 'dashboard-view', route: '/' }; // no stage → code/packaged
  const r = await installFeature(appStoreApi, packaged, {});
  assert.equal(r.installed, true);
  assert.deepEqual(calls[0], { dashboard: { enabled: true } });
});

test('declarativeRoutes — only installed declarative rows are merged (code stage untouched)', () => {
  const catalogue = [CODE, DECL];
  const prefs = { 'tickets-view': { enabled: true, installed_version: DECL.document_iri, installed_sri: 'h' } };
  const routes = declarativeRoutes(catalogue, prefs);
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], { name: 'tickets-view', path: '/tickets-view', roles: ['all'], menu: true, dynamic: true });
  // disabled in prefs → not merged
  assert.equal(declarativeRoutes(catalogue, {}).length, 0);
});
