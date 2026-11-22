// TCK — components in DOM (happy-dom): CA-A1 (<app-menu> = enabled features,
// sorted, updated live) and CA-A4 (guard). The store is mocked.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';

let window;
let appStore;

const POD = 'https://pod.test';
const FEATURES = {
  '/features/': {
    'ldp:contains': [
      { '@id': '/features/energy-chart' },
      { '@id': '/features/building-map' },
      { '@id': '/features/ticket-board' },
    ],
  },
  '/features/energy-chart': { '@id': '/features/energy-chart', slug: 'energy-chart', title_i18n: { en: 'Charts', fr: 'Graphiques' }, icon: 'show_chart', menu_order: 20, route: '/chart', default_enabled: false },
  '/features/building-map': { '@id': '/features/building-map', slug: 'building-map', title_i18n: { en: 'Map', fr: 'Carte' }, icon: 'map', menu_order: 10, route: '/map', default_enabled: true },
  '/features/ticket-board': { '@id': '/features/ticket-board', slug: 'ticket-board', title_i18n: { en: 'Tickets', fr: 'Tickets' }, icon: 'confirmation_number', menu_order: 30, route: '/tickets', default_enabled: false },
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: {
  'building-map': { enabled: true, config: {} },
  'energy-chart': { enabled: true, config: {} },
  'ticket-board': { enabled: false, config: {} },
  'ghost-feature': { enabled: true },   // §1.9.4d: slug unknown to the catalogue → ignored
} };

// full fetchAuthn: serves catalogue + prefs, PATCH mutates PREFS (simple merge).
function makeFetch(calls = []) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push([init.method ?? 'GET', u, init]);
    if ((init.method ?? 'GET') === 'PATCH') {
      const body = JSON.parse(init.body ?? '{}');
      for (const [slug, v] of Object.entries(body.prefs ?? {})) {
        PREFS.prefs[slug] = { ...(PREFS.prefs[slug] ?? {}), ...v };
      }
      return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? '"v9"' : null) }, json: async () => PREFS };
    }
    if (u === '/features/') return { ok: true, status: 200, headers: { get: () => null }, json: async () => FEATURES['/features/'] };
    if (FEATURES[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => FEATURES[u] };
    if (u === '/prefs/7') return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? '"v8"' : null) }, json: async () => PREFS };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

before(async () => {
  window = setupDom();
  window.orbit = {
    ready: Promise.resolve(),
    routes: [
      { name: 'map', path: '/map' },
      { name: 'chart', path: '/chart' },
      { name: 'tickets', path: '/tickets' },
    ],
  };
  window.__calls = [];
  window.sibStore = { fetchAuthn: makeFetch(window.__calls) };
  const mod = await import('../components/shared/app-store-api.js');
  appStore = mod.appStore;
  appStore.configure({ getWebid: () => `${POD}/users/7`, getRole: () => 'manager', podUrl: POD });
  await import('../components/app-menu/app-menu.js');
  await import('../components/app-store/app-store.js');
});

async function mount(tag) {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fireOrbitReady();
  await appStore.refresh().catch(() => {}); // a 404 catalogue is handled by the component (panel)
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

test('CA-A1 <app-menu> shows exactly the enabled=true features, sorted (menu_order, slug)', async () => {
  const menu = await mount('app-menu');
  const links = [...menu.renderRoot.querySelectorAll('.menu-link')];
  // building-map (10, enabled) + energy-chart (20, enabled); ticket-board disabled; ghost ignored
  assert.deepEqual(links.map((a) => a.dataset.path), ['/map', '/chart']);
  assert.deepEqual(links.map((a) => a.querySelector('.lbl')?.textContent), ['Map', 'Charts']);
  assert.ok(links.every((a) => a.querySelector('svg.icon')), 'inline SVG icons (Material Icons ligatures do not pierce the shadow DOM)');
});

test('CA-A1 live update: a prefs PATCH regenerates the menu without reload', async () => {
  const menu = await mount('app-menu');
  await appStore.patchPrefs({ 'energy-chart': { enabled: false } });
  await menu.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await menu.updateComplete;
  const links = [...menu.renderRoot.querySelectorAll('.menu-link')];
  assert.deepEqual(links.map((a) => a.dataset.path), ['/map']); // energy-chart disappears live
});

test('CA-A4 guard installed by <app-menu>: route of a disabled feature → redirect /', async () => {
  await mount('app-menu'); // connectedCallback installs the guard
  const navs = [];
  document.addEventListener('requestNavigation', (e) => navs.push(e.detail?.resource), true);
  document.dispatchEvent(new CustomEvent('requestNavigation', { detail: { route: 'tickets', resource: '/tickets' }, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(navs.includes('/'), 'redirect / emitted for /tickets (disabled feature)');
});

test('<app-store>: GET /features/ → 404 (model not deployed) → explicit panel, no crash', async () => {
  const prevFetch = window.sibStore.fetchAuthn;
  window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: 'nf' }) }) };
  const store = await mount('app-store');
  assert.equal(store.catalogueMissing, true);
  const err = store.renderRoot.querySelector('.error');
  assert.ok(err, 'error panel rendered');
  assert.match(err.textContent, /app-store\.model\.json/);   // procedure: JSON fragment at boot
  assert.match(err.textContent, /012_backfill_prefs\.sql/);  // + one-shot migration
  window.sibStore = { fetchAuthn: prevFetch }; // restore for the following tests
});

test('<app-store>: catalogue list + toggle PATCH form R1 + configured badge', async () => {
  window.sibStore = { fetchAuthn: makeFetch(window.__calls) }; // clean mock (the 404 test polluted it)
  PREFS.prefs['energy-chart'].enabled = true;
  PREFS.prefs['building-map'].config = { layers: ['pv'] }; // configured (§1.9.11)
  const store = await mount('app-store');

  const cards = [...store.renderRoot.querySelectorAll('.feature')];
  assert.equal(cards.length, 3); // the whole catalogue is listed (on/off)
  const switches = [...store.renderRoot.querySelectorAll('.switch input')];
  assert.deepEqual(switches.map((s) => s.checked), [true, true, false]); // map, chart, tickets
  assert.equal(store.renderRoot.querySelectorAll('.badge.configured').length, 1); // building-map configured

  // toggle building-map → PATCH form R1 on /prefs/7
  const calls = window.__calls;
  const before = calls.length;
  switches[0].click();
  await new Promise((r) => setTimeout(r, 10));
  const patch = calls.slice(before).find(([m, u]) => m === 'PATCH' && u === '/prefs/7');
  assert.ok(patch, 'PATCH emitted');
  // §1.5 read-modify-write: body = COMPLETE merged prefs (merge by slug)
  const body = JSON.parse(patch[2].body);
  assert.equal(body.prefs['building-map'].enabled, false);
  assert.deepEqual(body.prefs['building-map'].config, { layers: ['pv'] }); // config preserved by the merge
  assert.equal(body.prefs['energy-chart'].enabled, true);                  // other features preserved
});
