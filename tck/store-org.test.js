// TCK — organisation du <app-store> par catégorie (spec §1.6.2 révisée, migration
// 021_features_category.sql) : sections par rayon, chips de filtre avec compteurs,
// recherche texte, état vide. Le menu <app-menu> reste plat (non testé ici).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';

let window;
let appStore;

const POD = 'https://pod.test';
const FEATURES = {
  '/features/': { 'ldp:contains': [
    { '@id': '/features/dashboard' },
    { '@id': '/features/tickets' },
    { '@id': '/features/pv-selfconsumption' },
    { '@id': '/features/loose' },
  ] },
  '/features/dashboard': { '@id': '/features/dashboard', slug: 'dashboard', title_i18n: { en: 'Dashboard' }, description_i18n: { en: 'Overview of the site.' }, icon: 'dashboard', menu_order: 0, route: '/', category: 'supervision', default_enabled: true, component: 'building-map' },
  '/features/tickets': { '@id': '/features/tickets', slug: 'tickets', title_i18n: { en: 'Tickets' }, description_i18n: { en: 'Anomaly tickets.' }, icon: 'confirmation_number', menu_order: 10, route: '/tickets', category: 'operations', default_enabled: false },
  '/features/pv-selfconsumption': { '@id': '/features/pv-selfconsumption', slug: 'pv-selfconsumption', title_i18n: { en: 'PV self-consumption' }, description_i18n: { en: 'PV self-consumption rate.' }, icon: 'solar_power', menu_order: 20, route: '/pv', category: 'energy', default_enabled: false, npm_package: '@facis/app-features', version: '0.1.0', cdn_url: '/features-dist/pv-selfconsumption.js', sri: 'sha384-AAAA', tag: 'pv-gauge' },
  '/features/loose': { '@id': '/features/loose', slug: 'loose', title_i18n: { en: 'Loose feature' }, icon: 'extension', menu_order: 30, route: '/loose', default_enabled: false }, // sans category
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: { dashboard: { enabled: true } } };

function makeFetch(calls) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push([init.method ?? 'GET', u]);
    if (FEATURES[u]) return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => FEATURES[u] };
    if (u === '/prefs/7') return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => PREFS };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

async function mountStore() {
  const calls = [];
  window.sibStore = { fetchAuthn: makeFetch(calls) };
  const el = document.createElement('app-store');
  document.body.appendChild(el);
  fireOrbitReady();
  await appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'gestionnaire' });
  await appStore.refresh().catch(() => {});
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const tick = async (el) => { await new Promise((r) => setTimeout(r, 10)); await el.updateComplete; };
const cardSlugs = (el) => [...el.renderRoot.querySelectorAll('.feature h3')].map((h) => h.textContent);

before(async () => {
  window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [{ name: 'dashboard', path: '/' }] };
  ({ appStore } = await import('../components/shared/app-store-api.js'));
  await import('../components/app-store/app-store.js');
});

test('store organisé en sections par catégorie, chips « All » + une par rayon avec compteurs', async () => {
  const store = await mountStore();
  const sections = [...store.renderRoot.querySelectorAll('section.cat')];
  // 4 features réparties en supervision / operations / energy / (sans catégorie)
  assert.deepEqual(sections.map((s) => s.dataset.category), ['supervision', 'operations', 'energy', 'other']);
  assert.deepEqual(sections.map((s) => s.querySelector('h2').textContent), ['Supervision', 'Operations', 'Energy & optimization', 'Other']);
  assert.equal(sections[0].querySelectorAll('.feature').length, 1);

  const chips = [...store.renderRoot.querySelectorAll('.chip')];
  assert.deepEqual(chips.map((c) => c.textContent), ['All (4)', 'Supervision (1)', 'Operations (1)', 'Energy & optimization (1)', 'Other (1)']);
  assert.equal(chips[0].classList.contains('on'), true, 'chip « All » active par défaut');
});

test('chip de filtre : ne montre que le rayon choisi ; « All » restaure tout', async () => {
  const store = await mountStore();
  const chips = [...store.renderRoot.querySelectorAll('.chip')];
  chips.find((c) => c.textContent.startsWith('Energy')).click();
  await tick(store);
  assert.deepEqual(cardSlugs(store), ['PV self-consumption']);
  assert.deepEqual([...store.renderRoot.querySelectorAll('section.cat')].map((s) => s.dataset.category), ['energy']);
  chips[0].click(); // All
  await tick(store);
  assert.equal(store.renderRoot.querySelectorAll('.feature').length, 4);
});

test('recherche texte : filtre les cartes sur titre/slug/description, état vide si rien', async () => {
  const store = await mountStore();
  const search = store.renderRoot.querySelector('input.search');
  search.value = 'pv';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(store);
  assert.deepEqual(cardSlugs(store), ['PV self-consumption']);

  search.value = 'zzzz';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(store);
  assert.equal(store.renderRoot.querySelectorAll('.feature').length, 0);
  assert.match(store.renderRoot.textContent, /No feature matches/);

  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(store);
  assert.equal(store.renderRoot.querySelectorAll('.feature').length, 4);
});

test('recherche + chip combinés : intersection des deux filtres', async () => {
  const store = await mountStore();
  const chips = [...store.renderRoot.querySelectorAll('.chip')];
  chips.find((c) => c.textContent.startsWith('Supervision')).click();
  await tick(store);
  const search = store.renderRoot.querySelector('input.search');
  search.value = 'ticket'; // n'existe pas dans le rayon supervision
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(store);
  assert.equal(store.renderRoot.querySelectorAll('.feature').length, 0);
  assert.match(store.renderRoot.textContent, /No feature matches/);
});
