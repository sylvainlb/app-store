// TCK v2 UI — modale d'installation dans <app-store> (remplace le window.confirm brut,
// §2.2.3) : titre/description/package@version/empreinte SHA-384 raccourcie, Annuler sans
// effet, Installer → SRI vérifié → prefs installPatch ; sri invalide → refusée, aucun PATCH.
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
    title_i18n: { en: 'PV self-consumption' }, description_i18n: { en: 'PV self-consumption rate.' },
    icon: 'solar_power', menu_order: 20, route: '/pv', role_min: 'gestionnaire', default_enabled: false,
    npm_package: '@facis/app-features', version: '0.1.0',
    cdn_url: '/features-dist/pv-selfconsumption.js', sri: SRI, tag: 'pv-gauge',
  },
  '/features/dashboard': {
    '@id': '/features/dashboard', slug: 'dashboard', title_i18n: { en: 'Dashboard' },
    icon: 'map', menu_order: 0, route: '/', role_min: 'gestionnaire', default_enabled: true, component: 'building-map',
    config_schema: { fields: [{ key: 'refresh_s', label: 'Refresh (s)', type: 'number', default: 60 }] },
  },
  '/features/budget-tracker': {
    '@id': '/features/budget-tracker', slug: 'budget-tracker', title_i18n: { en: 'Budget tracker' },
    icon: 'savings', menu_order: 30, route: '/budget', role_min: 'gestionnaire', default_enabled: false,
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
  await appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'gestionnaire' });
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

test('v2 UI : toggle d\'une feature distante → modale lisible (titre, package@version, sri raccourci), pas de window.confirm', async () => {
  const calls = [];
  const store = await mountStore(calls);
  const cards = [...store.renderRoot.querySelectorAll('.feature')];
  const distCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption'));
  assert.ok(distCard, 'carte de la feature distante');
  assert.ok(cards.every((c) => c.querySelector('.head svg.icon')), 'icônes des cartes en SVG inline (shadow DOM)');
  // badges typés (couleurs) : la feature distante désactivée + non installée a .badge.remote
  assert.ok(distCard.querySelector('.badge.remote'), 'badge .remote (indigo) sur feature distante non installée');
  // distante mais ACTIVÉE (ex. default_enabled) → pas de badge « not installed » :
  // à la navigation le bundle est chargé + SRI vérifié + enregistré (installPatch)
  PREFS.prefs['pv-selfconsumption'] = { enabled: true };
  await appStore.refresh();
  await store.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await store.updateComplete;
  const distCardOn = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption'));
  assert.equal(distCardOn.querySelector('.badge.remote'), null, 'pas de badge « not installed » si la feature est active');
  assert.equal(distCardOn.querySelector('.badge.installed'), null, 'pas encore « installed » avant la 1re navigation');
  // le bouton « Configurer » n'apparaît que si config_schema a des champs
  const hasBtn = (c) => [...c.querySelectorAll('.actions button')].some((b) => b.textContent.trim() === 'Configure');
  assert.equal(hasBtn(distCard), false, 'no Configure button without config_schema');
  const dashCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('Dashboard'));
  assert.equal(hasBtn(dashCard), true, 'Configure button present when enabled + fields');
  const budgetCard = cards.find((c) => c.querySelector('h3')?.textContent.includes('Budget tracker'));
  assert.equal(hasBtn(budgetCard), false, 'no Configure button when the feature is disabled (even with fields)');
  // on repasse la feature en « désactivée » pour tester le toggle ON → modale d'installation
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
  assert.equal(confirmCalled, false, 'plus de window.confirm');
  assert.equal(sw.checked, false, 'la case ne passe pas avant confirmation');

  const modal = store.renderRoot.querySelector('.modal[role="dialog"]');
  assert.ok(modal, 'modale ouverte');
  const text = modal.textContent;
  assert.ok(text.includes('Install “PV self-consumption”?'), 'titre lisible');
  assert.ok(text.includes('@facis/app-features@0.1.0'), 'package@version');
  assert.ok(text.includes('sha384-'), 'empreinte mentionnée');
  assert.ok(!text.includes(SRI), 'empreinte raccourcie (pas le hash complet en clair)');
  assert.ok(modal.querySelector('.sri code').title === SRI, 'sri complet au survol (title)');
  assert.ok(text.includes('your rights'), 'mention de confiance (§2.2.6)');
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0, 'aucun PATCH avant confirmation');
});

test('v2 UI : Annuler ferme la modale sans rien installer', async () => {
  const calls = [];
  const store = await mountStore(calls);
  const sw = [...store.renderRoot.querySelectorAll('.feature')].find((c) => c.querySelector('h3')?.textContent.includes('PV self-consumption')).querySelector('.switch input');
  sw.click();
  await tick(store);
  store.renderRoot.querySelector('.modal .foot .secondary').click(); // Cancel
  await tick(store);
  assert.equal(store.renderRoot.querySelector('.modal'), null, 'modale fermée');
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0);
});

test('v2 UI : Installer → SRI vérifié → PATCH installPatch (enabled + installed_version + installed_sri)', async () => {
  const calls = [];
  // hook de test : fetch du binaire + import via data: (node n'importe pas les blob:)
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
  assert.equal(patches.length, 1, 'un PATCH de prefs');
  const body = JSON.parse(patches[0][2].body);
  assert.deepEqual(body.prefs['pv-selfconsumption'], { enabled: true, installed_version: '0.1.0', installed_sri: SRI });
  assert.equal(store.renderRoot.querySelector('.modal'), null, 'modale fermée après install');
  assert.ok(store.toast.includes('installed'), `success toast (got: ${store.toast})`);
  window.__appStoreLoaderDeps = undefined;
});

test('v2 UI : sri invalide → installation refusée, aucun PATCH de prefs (CA-A5)', async () => {
  const calls = [];
  // le cache du loader (même cdn_url + même sri = hit légitime) est évincé pour forcer le re-fetch
  const { evictModule } = await import('../components/shared/loader.js');
  evictModule(FEATURES['/features/pv-selfconsumption'].cdn_url);
  window.__appStoreLoaderDeps = {
    fetchFn: async () => ({ ok: true, status: 200, text: async () => MODULE + '// modifié' }), // bytes ≠ sri
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
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 0, 'CA-A5 : aucun PATCH si le sri ne colle pas');
  assert.ok(store.toast.includes('refused'), `refusal toast (got: ${store.toast})`);
  window.__appStoreLoaderDeps = undefined;
});
