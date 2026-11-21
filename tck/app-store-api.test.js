// TCK — window.appStore : contrat PATCH (forme R1 §1.5), événement save (§1.9.9),
// gestion 412, mePrefsIri (§1.9.12), isEnabled depuis le cache (§1.9.7).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';

let window;
let appStore;
let AppStoreConflictError;

const POD = 'https://pod.test';
const CATALOGUE = {
  'ldp:contains': [
    { '@id': '/features/building-map' },
    { '@id': '/features/energy-chart' },
  ],
};
const FEATURES = {
  '/features/building-map': { '@id': '/features/building-map', slug: 'building-map', default_enabled: true, menu_order: 10, route: '/map' },
  '/features/energy-chart': { '@id': '/features/energy-chart', slug: 'energy-chart', default_enabled: false, menu_order: 20, route: '/chart' },
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: { 'building-map': { enabled: true, config: {} } } };

// fetchAuthn mock : sert le catalogue + les prefs, journalise les PATCH.
function makeFetch(calls, { patchStatus = 200, patchBody = null, etag = '"v1"' } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push([init.method ?? 'GET', u, init]);
    if ((init.method ?? 'GET') === 'PATCH') {
      if (patchStatus !== 200) return { ok: false, status: patchStatus, headers: { get: () => null }, json: async () => ({ error: 'precondition failed' }) };
      return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? '"v2"' : null) }, json: async () => (patchBody ?? { ...PREFS, prefs: { 'building-map': { enabled: false } } }) };
    }
    if (u === '/features/') return { ok: true, status: 200, headers: { get: () => null }, json: async () => CATALOGUE };
    if (FEATURES[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => FEATURES[u] };
    if (u === '/prefs/7') return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? etag : null) }, json: async () => PREFS };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

before(async () => {
  window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [{ name: 'map', path: '/map' }, { name: 'chart', path: '/chart' }] };
  const mod = await import('../components/shared/app-store-api.js');
  appStore = mod.appStore;
  AppStoreConflictError = mod.AppStoreConflictError;
});

test('§1.9.12 mePrefsIri : configure({getWebid, podUrl}) → /prefs/<pk> ; hors pod → null', () => {
  assert.equal(appStore.configure({ getWebid: () => `${POD}/users/7`, podUrl: POD }), '/prefs/7');
  assert.equal(appStore.mePrefsIri(), '/prefs/7');
  appStore.configure({ getWebid: () => 'https://other.test/users/1', podUrl: POD });
  assert.equal(appStore.mePrefsIri(), null); // webid hors pod interdit en v1
  appStore.configure({ getWebid: () => `${POD}/users/7`, podUrl: POD });
});

test('refresh charge catalogue + prefs ; isEnabled lit le cache (§1.9.7, clé absente = default)', async () => {
  const calls = [];
  window.sibStore = { fetchAuthn: makeFetch(calls) };
  await appStore.refresh();
  assert.equal(appStore.getFeature('building-map').route, '/map');
  assert.equal(appStore.isEnabled('building-map'), true);  // pref enabled=true
  assert.equal(appStore.isEnabled('energy-chart'), false); // clé absente → default_enabled=false
  assert.equal(appStore.isEnabled('inconnu'), false);      // feature inconnue → false
});

test('CA-A2 patchPrefs : PATCH merge-patch forme R1 + If-Match + événement save + read-after-write', async () => {
  const calls = [];
  window.sibStore = { fetchAuthn: makeFetch(calls) };
  await appStore.refresh();

  const saves = [];
  document.addEventListener('save', (e) => saves.push(e.detail));

  await appStore.patchPrefs({ 'building-map': { enabled: false } });

  const patch = calls.find(([m, u]) => m === 'PATCH' && u === '/prefs/7');
  assert.ok(patch, 'PATCH émis sur /prefs/7');
  const [, , init] = patch;
  assert.equal(init.headers['content-type'], 'application/merge-patch+json');
  assert.equal(init.headers['if-match'], '"v1"'); // ETag du GET précédent
  // forme R1 §1.5 : body {"prefs": {…}} — PAS de slug à la racine.
  // Le serveur REMPLACE la colonne jsonb entière → read-modify-write : body =
  // objet complet fusionné (merge par slug : la config existante est préservée).
  assert.deepEqual(JSON.parse(init.body), { prefs: { 'building-map': { config: {}, enabled: false } } });

  // read-after-write : la réponse PATCH met à jour le cache
  assert.equal(appStore.isEnabled('building-map'), false);
  // §1.9.9 : save dispatché avec l'@id des prefs
  assert.equal(saves.length, 1);
  assert.equal(saves[0].resource['@id'], `${POD}/prefs/7`);
});

test('§1.9.9 — 412 : prefs rechargées + AppStoreConflictError', async () => {
  const calls = [];
  let patchCount = 0;
  const fetchMock = async (url, init = {}) => {
    const u = String(url);
    calls.push([init.method ?? 'GET', u]);
    if ((init.method ?? 'GET') === 'PATCH') {
      patchCount += 1;
      if (patchCount === 1) return { ok: false, status: 412, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => '"v3"' }, json: async () => PREFS };
    }
    if (u === '/features/') return { ok: true, status: 200, headers: { get: () => null }, json: async () => CATALOGUE };
    if (FEATURES[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => FEATURES[u] };
    if (u === '/prefs/7') return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => PREFS };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  window.sibStore = { fetchAuthn: fetchMock };
  await appStore.refresh();
  const getsBefore = calls.filter(([m]) => m === 'GET').length;

  await assert.rejects(() => appStore.patchPrefs({ 'energy-chart': { enabled: true } }), AppStoreConflictError);
  const getsAfter = calls.filter(([m]) => m === 'GET').length;
  assert.ok(getsAfter > getsBefore, 'les prefs sont rechargées après le 412');
});

test('CA-A4 guard : requestNavigation vers une route de feature désactivée → redirect /', async () => {
  const calls = [];
  window.sibStore = { fetchAuthn: makeFetch(calls) };
  await appStore.refresh();
  appStore.installRouteGuard({ defaultPath: '/' });

  const navs = [];
  document.addEventListener('requestNavigation', (e) => navs.push(e.detail?.resource ?? e.detail?.route));

  // energy-chart (route /chart) est désactivée → navigation interceptée
  document.dispatchEvent(new CustomEvent('requestNavigation', { detail: { route: 'chart', resource: '/chart' }, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(navs.includes('/'), `redirect / émis (navs=${JSON.stringify(navs)})`);

  // building-map (route /map) est activée → navigation laissée passer
  navs.length = 0;
  const ev = new CustomEvent('requestNavigation', { detail: { route: 'map', resource: '/map' }, cancelable: true });
  document.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!ev.defaultPrevented, 'navigation non bloquée pour une feature active');
});
