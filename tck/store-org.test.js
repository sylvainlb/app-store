// TCK — <app-store> organization by category (revised spec §1.6.2, migration
// 021_features_category.sql): sections per category, filter chips with counters,
// text search, empty state. The <app-menu> menu stays flat (not tested here).
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
  '/features/dashboard': { '@id': '/features/dashboard', slug: 'dashboard', title_i18n: { en: 'Dashboard', fr: 'Tableau de bord' }, description_i18n: { en: 'Overview of the site.', fr: 'Vue d\'ensemble du site.' }, icon: 'dashboard', menu_order: 0, route: '/', category: 'supervision', default_enabled: true, component: 'building-map' },
  '/features/tickets': { '@id': '/features/tickets', slug: 'tickets', title_i18n: { en: 'Tickets', fr: 'Tickets' }, description_i18n: { en: 'Anomaly tickets.', fr: 'Tickets d\'anomalie.' }, icon: 'confirmation_number', menu_order: 10, route: '/tickets', category: 'operations', default_enabled: false },
  '/features/pv-selfconsumption': { '@id': '/features/pv-selfconsumption', slug: 'pv-selfconsumption', title_i18n: { en: 'PV self-consumption', fr: 'Autoconsommation PV' }, description_i18n: { en: 'PV self-consumption rate.', fr: 'Taux d\'autoconsommation PV.' }, icon: 'solar_power', menu_order: 20, route: '/pv', category: 'energy', default_enabled: false, npm_package: '@facis/app-features', version: '0.1.0', cdn_url: '/features-dist/pv-selfconsumption.js', sri: 'sha384-AAAA', tag: 'pv-gauge' },
  '/features/loose': { '@id': '/features/loose', slug: 'loose', title_i18n: { en: 'Loose feature', fr: 'Feature orpheline' }, icon: 'extension', menu_order: 30, route: '/loose', default_enabled: false }, // no category
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
  await appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'manager' });
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

test('store organized in sections by category, chips "All" + one per category with counters', async () => {
  const store = await mountStore();
  const sections = [...store.renderRoot.querySelectorAll('section.cat')];
  // 4 features spread over supervision / operations / energy / (no category)
  assert.deepEqual(sections.map((s) => s.dataset.category), ['supervision', 'operations', 'energy', 'other']);
  assert.deepEqual(sections.map((s) => s.querySelector('h2').textContent), ['Supervision', 'Operations', 'Energy & optimization', 'Other']);
  assert.equal(sections[0].querySelectorAll('.feature').length, 1);

  const chips = [...store.renderRoot.querySelectorAll('.chip')];
  assert.deepEqual(chips.map((c) => c.textContent), ['All (4)', 'Supervision (1)', 'Operations (1)', 'Energy & optimization (1)', 'Other (1)']);
  assert.equal(chips[0].classList.contains('on'), true, '"All" chip active by default');
});

test('filter chip: shows only the chosen category; "All" restores everything', async () => {
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

test('text search: filters cards on title/slug/description, empty state if nothing', async () => {
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

test('search + chip combined: intersection of the two filters', async () => {
  const store = await mountStore();
  const chips = [...store.renderRoot.querySelectorAll('.chip')];
  chips.find((c) => c.textContent.startsWith('Supervision')).click();
  await tick(store);
  const search = store.renderRoot.querySelector('input.search');
  search.value = 'ticket'; // does not exist in the supervision category
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(store);
  assert.equal(store.renderRoot.querySelectorAll('.feature').length, 0);
  assert.match(store.renderRoot.textContent, /No feature matches/);
});
