// TCK v2 UI — install modal in <app-store> (replaces the raw window.confirm,
// §2.2.3): title/description/package@version/shortened SHA-384 fingerprint, Cancel with
// no effect, Install → SRI verified → prefs installPatch; invalid sri → refused, no PATCH.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';

let window;
let appStore;

const POD = 'https://pod.test';
const MODULE = 'customElements.define("pv-gauge", class extends HTMLElement {});\nglobalThis.__v2ui = true;\nexport default {};\n';
const SRI = 'sha384-' + Buffer.from(
  await crypto.subtle.digest('SHA-384', new TextEncoder().encode(MODULE))).toString('base64');

const FEATURES = {
  '/features/': { 'ldp:contains': [{ '@id': '/features/pv-selfconsumption' }, { '@id': '/features/dashboard' }, { '@id': '/features/budget-tracker' }] },
  '/features/pv-selfconsumption': {
    '@id': '/features/pv-selfconsumption', slug: 'pv-selfconsumption',
    title_i18n: { en: 'PV self-consumption', fr: 'Autoconsommation PV' }, description_i18n: { en: 'PV self-consumption rate.', fr: 'Taux d\'autoconsommation PV.' },
    icon: 'solar_power', menu_order: 20, route: '/pv', role_min: 'manager', default_enabled: false,
    npm_package: '@facis/app-features', version: '0.1.0',
    cdn_url: '/features-dist/pv-selfconsumption.js', sri: SRI, tag: 'pv-gauge',
  },
  '/features/dashboard': {
    '@id': '/features/dashboard', slug: 'dashboard', title_i18n: { en: 'Dashboard', fr: 'Tableau de bord' },
    icon: 'map', menu_order: 0, route: '/', role_min: 'manager', default_enabled: true, component: 'building-map',
    config_schema: { fields: [{ key: 'refresh_s', label: 'Refresh (s)', type: 'number', default: 60 }] },
  },
  '/features/budget-tracker': {
    '@id': '/features/budget-tracker', slug: 'budget-tracker', title_i18n: { en: 'Budget tracker', fr: 'Suivi de budget' },
    icon: 'savings', menu_order: 30, route: '/budget', role_min: 'manager', default_enabled: false,
    config_schema: { fields: [{ key: 'budget_kwh', label: 'Budget (kWh)', type: 'number', required: true }] },
  },
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: { dashboard: { enabled: true } } };

function makeFetch(calls) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push([init.method ?? 'GET', u, init]);
    if ((init.method ?? 'GET') === 'PATCH') {
      const body = JSON.parse(init.body ?? '{}');
      for (const [slug, v] of Object.entries(body.prefs ?? {})) PREFS.prefs[slug] = { ...(PREFS.prefs[slug] ?? {}), ...v };
      return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? '"v9"' : null) }, json: async () => PREFS };
    }
    if (FEATURES[u]) return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => FEATURES[u] };
    if (u === '/prefs/7') return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => PREFS };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

async function mountStore(calls) {
  PREFS.prefs = { dashboard: { enabled: true } }; // reset (le mock PATCH mute PREFS)
  window.sibStore = { fetchAuthn: makeFetch(calls) };
  const el = document.createElement('app-store');
  document.body.appendChild(el);
  fireOrbitReady();
  await appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'manager' });
  await appStore.refresh().catch(() => {});
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const tick = async (el) => { await new Promise((r) => setTimeout(r, 10)); await el.updateComplete; };

before(async () => {
  window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [{ name: 'dashboard', path: '/' }] };
  ({ appStore } = await import('../components/shared/app-store-api.js'));
  await import('../components/app-store/app-store.js');
});

test('v2 UI: toggling a remote feature → readable modal (title, package@version, shortened sri), no window.confirm', async () => {
  const calls = [];
  const store = await mountStore(calls);
  const cards = [...store.renderRoot.querySelectorAll('.feature')];
  const distCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption'));
  assert.ok(distCard, 'card of the remote feature');
  assert.ok(cards.every((c) => c.querySelector('.head svg.icon')), 'card icons in inline SVG (shadow DOM)');
  // typed (colored) badges: the disabled + not-installed remote feature has .badge.remote
  assert.ok(distCard.querySelector('.badge.remote'), '.badge.remote (indigo) on a remote, not-installed feature');
  // remote but ENABLED (e.g. default_enabled) → no "not installed" badge:
  // on navigation the bundle is loaded + SRI verified + recorded (installPatch)
  PREFS.prefs['pv-selfconsumption'] = { enabled: true };
  await appStore.refresh();
  await store.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await store.updateComplete;
  const distCardOn = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption'));
  assert.equal(distCardOn.querySelector('.badge.remote'), null, 'no "not installed" badge if the feature is enabled');
  assert.equal(distCardOn.querySelector('.badge.installed'), null, 'not yet "installed" before the 1st navigation');
  // the "Configure" button only appears if config_schema has fields
  const hasBtn = (c) => [...c.querySelectorAll('.actions button')].some((b) => b.textContent.trim() === 'Configure');
  assert.equal(hasBtn(distCard), false, 'no Configure button without config_schema');
  const dashCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('Dashboard'));
  assert.equal(hasBtn(dashCard), true, 'Configure button present when enabled + fields');
  const budgetCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('Budget tracker'));
  assert.equal(hasBtn(budgetCard), false, 'no Configure button when the feature is disabled (even with fields)');
  // switch the feature back to "disabled" to test the ON toggle → install modal
  PREFS.prefs['pv-selfconsumption'] = { enabled: false };
  await appStore.refresh();
  await store.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await store.updateComplete;
  const sw = [...store.renderRoot.querySelectorAll('.feature')]
    .find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption'))
    .querySelector('.switch input');
  assert.equal(sw.checked, false);

  let confirmCalled = false;
  window.confirm = () => { confirmCalled = true; return true; };
  sw.click();
  await tick(store);
  assert.equal(confirmCalled, false, 'no more window.confirm');
  assert.equal(sw.checked, false, 'the checkbox does not switch before confirmation');

  const modal = store.renderRoot.querySelector('.modal[role="dialog"]');
  assert.ok(modal, 'modal open');
  const text = modal.textContent;
  assert.ok(text.includes('Install “PV self-consumption”?'), 'readable title');
  assert.ok(text.includes('@facis/app-features@0.1.0'), 'package@version');
  assert.ok(text.includes('sha384-'), 'fingerprint mentioned');
  assert.ok(!text.includes(SRI), 'shortened fingerprint (not the full hash in clear)');
  assert.ok(modal.querySelector('.sri code').title === SRI, 'full sri on hover (title)');
  assert.ok(text.includes('your rights'), 'trust notice (§2.2.6)');
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0, 'no PATCH before confirmation');
});

test('v2 UI: Cancel closes the modal without installing anything', async () => {
  const calls = [];
  const store = await mountStore(calls);
  const sw = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption')).querySelector('.switch input');
  sw.click();
  await tick(store);
  store.renderRoot.querySelector('.modal .foot .secondary').click(); // Cancel
  await tick(store);
  assert.equal(store.renderRoot.querySelector('.modal'), null, 'modal closed');
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0);
});

test('v2 UI: Install → SRI verified → PATCH installPatch (enabled + installed_version + installed_sri)', async () => {
  const calls = [];
  // test hook: fetch of the binary + import via data: (node does not import blob:)
  window.__appStoreLoaderDeps = {
    fetchFn: async () => ({ ok: true, status: 200, text: async () => MODULE }),
    importFn: async () => import('data:text/javascript;base64,' + Buffer.from(MODULE).toString('base64')),
  };
  const store = await mountStore(calls);
  const sw = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption')).querySelector('.switch input');
  sw.click();
  await tick(store);
  const btn = [...store.renderRoot.querySelectorAll('.modal .foot button')].find((b) => b.textContent.trim() === 'Install');
  btn.click();
  await tick(store);
  await tick(store);
  const patches = calls.filter(([m]) => m === 'PATCH');
  assert.equal(patches.length, 1, 'one prefs PATCH');
  const body = JSON.parse(patches[0][2].body);
  assert.deepEqual(body.prefs['pv-selfconsumption'], { enabled: true, installed_version: '0.1.0', installed_sri: SRI });
  assert.equal(store.renderRoot.querySelector('.modal'), null, 'modal closed after install');
  assert.ok(store.toast.includes('installed'), `success toast (got: ${store.toast})`);
  window.__appStoreLoaderDeps = undefined;
});

test('v2 UI: invalid sri → installation refused, no prefs PATCH (CA-A5)', async () => {
  const calls = [];
  // the loader cache (same cdn_url + same sri = legitimate hit) is evicted to force the re-fetch
  const { evictModule } = await import('../components/shared/loader.js');
  evictModule(FEATURES['/features/pv-selfconsumption'].cdn_url);
  // the tag was registered by the previous test's real import; hide it so this test exercises
  // the FETCH path (the alreadyRegistered short-circuit is covered in app-supervision's suite)
  const g = globalThis.customElements;
  const origGet = g.get.bind(g);
  g.get = (t) => (t === 'pv-gauge' ? undefined : origGet(t));
  window.__appStoreLoaderDeps = {
    fetchFn: async () => ({ ok: true, status: 200, text: async () => MODULE + '// changed' }), // bytes ≠ sri
    importFn: async () => ({}),
  };
  const store = await mountStore(calls);
  const sw = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption')).querySelector('.switch input');
  sw.click();
  await tick(store);
  const btn = [...store.renderRoot.querySelectorAll('.modal .foot button')].find((b) => b.textContent.trim() === 'Install');
  btn.click();
  await tick(store);
  await tick(store);
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0, 'CA-A5: no PATCH if the sri does not match');
  assert.ok(store.toast.includes('refused'), `refusal toast (got: ${store.toast})`);
  window.__appStoreLoaderDeps = undefined;
  g.get = origGet;
});
