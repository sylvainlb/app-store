// TCK — composants en DOM (happy-dom) : CA-A1 (<app-menu> = features enabled,
// triées, mises à jour à chaud) et CA-A4 (guard). Le store est mocké.
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
  '/features/energy-chart': { '@id': '/features/energy-chart', slug: 'energy-chart', title_i18n: { fr: 'Graphiques' }, icon: 'show_chart', menu_order: 20, route: '/chart', default_enabled: false },
  '/features/building-map': { '@id': '/features/building-map', slug: 'building-map', title_i18n: { fr: 'Carte' }, icon: 'map', menu_order: 10, route: '/map', default_enabled: true },
  '/features/ticket-board': { '@id': '/features/ticket-board', slug: 'ticket-board', title_i18n: { fr: 'Tickets' }, icon: 'confirmation_number', menu_order: 30, route: '/tickets', default_enabled: false },
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: {
  'building-map': { enabled: true, config: {} },
  'energy-chart': { enabled: true, config: {} },
  'ticket-board': { enabled: false, config: {} },
  'ghost-feature': { enabled: true },   // §1.9.4d : slug inconnu du catalogue → ignoré
} };

// fetchAuthn complet : sert catalogue + prefs, PATCH mute PREFS (merge simple).
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
  appStore.configure({ getWebid: () => `${POD}/users/7`, getRole: () => 'gestionnaire', podUrl: POD });
  await import('../components/app-menu/app-menu.js');
  await import('../components/app-store/app-store.js');
});

async function mount(tag) {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fireOrbitReady();
  await appStore.refresh().catch(() => {}); // un 404 catalogue est géré par le composant (panneau)
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

test('CA-A1 <app-menu> affiche exactement les features enabled=true, triées (menu_order, slug)', async () => {
  const menu = await mount('app-menu');
  const links = [...menu.renderRoot.querySelectorAll('.menu-link')];
  // building-map (10, enabled) + energy-chart (20, enabled) ; ticket-board désactivé ; ghost ignoré
  assert.deepEqual(links.map((a) => a.dataset.path), ['/map', '/chart']);
  assert.deepEqual(links.map((a) => a.querySelector('.lbl')?.textContent), ['Carte', 'Graphiques']);
  assert.ok(links.every((a) => a.querySelector('svg.icon')), 'icônes en SVG inline (les ligatures Material Icons ne pénètrent pas le shadow DOM)');
});

test('CA-A1 mise à jour à chaud : un PATCH de prefs régénère le menu sans rechargement', async () => {
  const menu = await mount('app-menu');
  await appStore.patchPrefs({ 'energy-chart': { enabled: false } });
  await menu.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await menu.updateComplete;
  const links = [...menu.renderRoot.querySelectorAll('.menu-link')];
  assert.deepEqual(links.map((a) => a.dataset.path), ['/map']); // energy-chart disparaît à chaud
});

test('CA-A4 guard installé par <app-menu> : route d’une feature désactivée → redirect /', async () => {
  await mount('app-menu'); // connectedCallback installe le guard
  const navs = [];
  document.addEventListener('requestNavigation', (e) => navs.push(e.detail?.resource), true);
  document.dispatchEvent(new CustomEvent('requestNavigation', { detail: { route: 'tickets', resource: '/tickets' }, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(navs.includes('/'), 'redirect / émis pour /tickets (feature désactivée)');
});

test('<app-store> : GET /features/ → 404 (modèle non déployé) → panneau explicite, pas de crash', async () => {
  const prevFetch = window.sibStore.fetchAuthn;
  window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: 'nf' }) }) };
  const store = await mount('app-store');
  assert.equal(store.catalogueMissing, true);
  const err = store.renderRoot.querySelector('.error');
  assert.ok(err, 'panneau erreur rendu');
  assert.match(err.textContent, /app-store\.model\.json/);   // procédure : fragment JSON au boot
  assert.match(err.textContent, /012_backfill_prefs\.sql/);  // + migration one-shot
  window.sibStore = { fetchAuthn: prevFetch }; // restaure pour les tests suivants
});

test('<app-store> : liste du catalogue + toggle PATCH forme R1 + badge configuré', async () => {
  window.sibStore = { fetchAuthn: makeFetch(window.__calls) }; // mock propre (test 404 a pollué)
  PREFS.prefs['energy-chart'].enabled = true;
  PREFS.prefs['building-map'].config = { layers: ['pv'] }; // configuré (§1.9.11)
  const store = await mount('app-store');

  const cards = [...store.renderRoot.querySelectorAll('.feature')];
  assert.equal(cards.length, 3); // tout le catalogue est listé (on/off)
  const switches = [...store.renderRoot.querySelectorAll('.switch input')];
  assert.deepEqual(switches.map((s) => s.checked), [true, true, false]); // map, chart, tickets
  assert.equal(store.renderRoot.querySelectorAll('.badge.configured').length, 1); // building-map configuré

  // toggle building-map → PATCH forme R1 sur /prefs/7
  const calls = window.__calls;
  const before = calls.length;
  switches[0].click();
  await new Promise((r) => setTimeout(r, 10));
  const patch = calls.slice(before).find(([m, u]) => m === 'PATCH' && u === '/prefs/7');
  assert.ok(patch, 'PATCH émis');
  // §1.5 read-modify-write : body = prefs COMPLÈTES fusionnées (merge par slug)
  const body = JSON.parse(patch[2].body);
  assert.equal(body.prefs['building-map'].enabled, false);
  assert.deepEqual(body.prefs['building-map'].config, { layers: ['pv'] }); // config préservé par le merge
  assert.equal(body.prefs['energy-chart'].enabled, true);                  // autres features préservées
});
