// TCK — <my-apps> "My apps" hub (route /my-apps): lists the user's published
// components from /components/ (UI + AI), badges by kind, and dispatches
// "new" → /editor | /ai-editor, "edit" → deep link ?component=<iri> (F7.3).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';
import {
  unwrapComponentResource, componentKind, componentLabel, componentEditLink,
} from '../components/shared/logic.js';

let window;
let navEvents;

const UI_DOC = {
  '@id': '/components/ticket-list', '@type': 'cmp:ListComponent',
  'cmp:label': { en: 'Ticket list', fr: 'Liste des tickets' },
  'cmp:contract': 'https://pod.test/shapes', 'cmp:source': 'https://pod.test/tickets/',
};
const AI_DOC = {
  '@id': '/components/maintenance-summary', '@type': 'cmp:AiComponent',
  'cmp:label': { en: 'Maintenance summary', fr: 'Résumé de maintenance' },
  'cmp:source': 'https://pod.test/interventions/', 'cmp:promptVersion': '1.2',
};
const COMPONENTS = {
  '/components/': { 'ldp:contains': [{ '@id': '/components/ticket-list' }, { '@id': '/components/maintenance-summary' }] },
  // enbikepe form (workstream 3 F6): { slug, sri, document }
  '/components/ticket-list': { '@id': '/components/ticket-list', slug: 'ticket-list', sri: 'sha384-aaa', document: UI_DOC },
  '/components/maintenance-summary': { '@id': '/components/maintenance-summary', slug: 'maintenance-summary', sri: 'sha384-bbb', document: AI_DOC },
};

function makeFetch(calls) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (COMPONENTS[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => COMPONENTS[u] };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

before(async () => {
  window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [] };
  window.sibStore = { fetchAuthn: makeFetch((window.__calls = [])) };
  document.addEventListener('requestNavigation', (e) => { (navEvents ??= []).push(e.detail); });
  await import('../components/my-apps/my-apps.js');
});

async function mount() {
  const el = document.createElement('my-apps');
  document.body.appendChild(el);
  fireOrbitReady();
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

test('logic: unwrapComponentResource / componentKind / componentLabel / componentEditLink', () => {
  const e = unwrapComponentResource(COMPONENTS['/components/ticket-list']);
  assert.equal(e.slug, 'ticket-list');
  assert.equal(componentKind(e.doc), 'ui');
  assert.equal(componentKind(AI_DOC), 'ai');
  assert.equal(componentKind({ '@type': 'x:Other' }), null);
  assert.equal(componentLabel(UI_DOC, 'fr'), 'Liste des tickets');
  assert.equal(componentLabel(UI_DOC, 'en'), 'Ticket list');
  assert.deepEqual(componentEditLink(e), { route: 'ui-editor', resource: `/editor?component=${encodeURIComponent('/components/ticket-list')}` });
  assert.deepEqual(componentEditLink(unwrapComponentResource(COMPONENTS['/components/maintenance-summary'])),
    { route: 'ai-editor', resource: `/ai-editor?component=${encodeURIComponent('/components/maintenance-summary')}` });
});

test('logic: unwrapComponentResource accepts fap-ldp prefixed keys (app_user_components:*)', () => {
  // fap-ldp serves resource fields as <table>:<col>; the envelope must still unwrap
  // so the row keeps its cmp:* @type and is not filtered out of /my-apps.
  const prefixed = {
    '@id': '/users/1/components/my-list',
    '@type': ['ldp:Resource', 'app_user_components:User_components'],
    'app_user_components:slug': 'my-list',
    'app_user_components:sri': 'sha384-ccc',
    'app_user_components:document': UI_DOC,
  };
  const e = unwrapComponentResource(prefixed);
  assert.equal(e.slug, 'my-list');
  assert.equal(e.sri, 'sha384-ccc');
  assert.equal(componentKind(e.doc), 'ui');
  // document stored as a JSON string is parsed too
  const asString = { ...prefixed, 'app_user_components:document': JSON.stringify(UI_DOC) };
  assert.equal(componentKind(unwrapComponentResource(asString).doc), 'ui');
});

test('<my-apps> lists /components/ with UI/IA badges, source and version', async () => {
  const el = await mount();
  const rows = el.shadowRoot.querySelectorAll('tbody tr');
  assert.equal(rows.length, 2);
  const html = el.shadowRoot.innerHTML;
  assert.ok(html.includes('Maintenance summary') && html.includes('Ticket list'), 'labels rendered');
  assert.ok(el.shadowRoot.querySelector('.badge.ai'), 'AI badge');
  assert.ok(el.shadowRoot.querySelector('.badge.ui'), 'UI badge');
  assert.ok(html.includes('https://pod.test/interventions/'), 'source column');
  assert.ok(html.includes('1.2'), 'AI prompt version column');
  el.remove();
});

test('<my-apps> single "New component" button -> /editor; "edit" to ?component=<iri>', async () => {
  navEvents = [];
  const el = await mount();
  const btns = el.shadowRoot.querySelectorAll('.head .new button');
  assert.equal(btns.length, 1, 'a single creation button (AI components are created from the AI block panel of the UI editor)');
  btns[0].click();
  assert.deepEqual(navEvents.at(-1), { route: 'ui-editor', resource: '/editor', query: null });
  // edit per row: find the AI row's Edit button
  const rows = [...el.shadowRoot.querySelectorAll('tbody tr')];
  const aiRow = rows.find((r) => r.querySelector('.badge.ai'));
  aiRow.querySelector('button').click();
  assert.equal(navEvents.at(-1).route, 'ai-editor');
  assert.ok(navEvents.at(-1).resource.startsWith('/ai-editor?component='), 'deep link with pinned IRI');
  assert.ok(decodeURIComponent(navEvents.at(-1).resource).includes('/components/maintenance-summary'));
  const uiRow = rows.find((r) => r.querySelector('.badge.ui'));
  uiRow.querySelector('button').click();
  assert.equal(navEvents.at(-1).route, 'ui-editor');
  assert.ok(decodeURIComponent(navEvents.at(-1).resource).includes('/components/ticket-list'));
  el.remove();
});

test('<my-apps> empty state when /components/ has no component — but the "New component" gesture stays visible', async () => {
  const saved = window.sibStore.fetchAuthn;
  window.sibStore.fetchAuthn = async (url) => String(url) === '/components/'
    ? { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ 'ldp:contains': [] }) }
    : { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  navEvents = [];
  const el = await mount();
  assert.ok(el.shadowRoot.querySelector('.empty'), 'empty state shown');
  // 'cr.ez' also matches the French imperative (single accented char), 'create' the English one
  assert.ok(!/cr.ez|create/i.test(el.shadowRoot.querySelector('.empty').textContent), 'empty message is not phrased as a clickable action');
  const btns = el.shadowRoot.querySelectorAll('.head .new button');
  assert.equal(btns.length, 1, 'the "new component" button still rendered when the list is empty');
  assert.ok(el.shadowRoot.querySelector('.head h1'), 'hub header rendered');
  assert.ok(el.shadowRoot.querySelector('.hint'), 'AI-block hint shown');
  btns[0].click();
  assert.deepEqual(navEvents.at(-1), { route: 'ui-editor', resource: '/editor', query: null }, 'new component reachable from the empty state');
  el.remove();
  window.sibStore.fetchAuthn = saved;
});

// ---------------------------------------------------------------------------
// v0.7 §1.4.4 — three-level storage: local container first, badges, Publish/Unpublish.
import { localComponentsPath, entryLevel, mergeLevels, verifyIntegrity, catalogueLineFor, sha384B64, canonicalJsonLite, hashableDocLite } from '../components/shared/logic.js';

const LOCAL_DOC = {
  '@id': '/users/3/components/my-view', '@type': 'cmp:ListComponent',
  'cmp:label': { en: 'My view', fr: 'Ma vue' },
  'cmp:contract': 'https://pod.test/shapes', 'cmp:source': 'https://pod.test/tickets/',
};

test('logic v0.7: localComponentsPath / entryLevel / mergeLevels (dedupe by slug, both badges)', async () => {
  assert.equal(localComponentsPath('https://pod.test/users/3'), '/users/3/components/');
  assert.equal(localComponentsPath('/prefs/3'), '/users/3/components/');
  assert.equal(localComponentsPath('https://other.example/users/9'), '/users/9/components/');
  const local = { iri: '/users/3/components/my-view', slug: 'my-view', sri: 's', doc: LOCAL_DOC };
  const pub = { iri: '/components/ticket-list', slug: 'ticket-list', sri: 's', doc: UI_DOC };
  const both = { iri: '/users/3/components/ticket-list', slug: 'ticket-list', sri: 's', doc: UI_DOC };
  const merged = mergeLevels([local, both], [pub, { ...both, iri: '/components/ticket-list' }]);
  assert.equal(merged.length, 2, 'one row per slug');
  const tl = merged.find((m) => m.slug === 'ticket-list');
  assert.deepEqual(tl.levels.sort(), ['local', 'published'], 'same slug in both levels → both badges');
  assert.equal(tl.iri, '/components/ticket-list', 'published IRI wins for the edit link');
  assert.deepEqual(mergeLevels([local], []).find((m) => m.slug === 'my-view').levels, ['local']);
  assert.equal(entryLevel(local), 'local');
  assert.equal(entryLevel(pub), 'published');
});

test('logic v0.7: verifyIntegrity recomputes the sha384 (canonical, @id excluded)', async () => {
  const doc = { '@id': '/users/3/components/x', '@type': 'cmp:ListComponent', 'cmp:label': { en: 'X' }, z: 1, a: [1, 2] };
  const sri = await sha384B64(canonicalJsonLite(hashableDocLite(doc)));
  assert.ok(await verifyIntegrity({ sri, doc }));
  assert.ok(await verifyIntegrity({ sri: 'sha384-' + sri, doc }), 'SRI-prefixed accepted');
  assert.ok(!(await verifyIntegrity({ sri: 'sha384-bad', doc })));
  assert.ok(!(await verifyIntegrity({ sri, doc: { ...doc, z: 2 } })), 'tampered doc → rejected');
  const line = catalogueLineFor({ slug: 'x', sri, iri: '/components/x', doc });
  assert.equal(line.stage, 'declarative');
  assert.equal(line.document_iri, '/components/x');
  assert.equal(line.component, 'cmp-runtime');
  assert.equal(line.sri, sri);
});

test('<my-apps> v0.7: local + published aggregated with badges; Publish = sha384 + PUT /components/ + POST /features/; Unpublish = DELETEs, local kept', async () => {
  const sriLocal = await sha384B64(canonicalJsonLite(hashableDocLite(LOCAL_DOC)));
  const calls = [];
  const DATA = {
    '/users/3/components/': { 'ldp:contains': [{ '@id': '/users/3/components/my-view' }] },
    '/users/3/components/my-view': { '@id': '/users/3/components/my-view', slug: 'my-view', sri: sriLocal, document: LOCAL_DOC },
    '/components/': { 'ldp:contains': [{ '@id': '/components/ticket-list' }] },
    '/components/ticket-list': { '@id': '/components/ticket-list', slug: 'ticket-list', sri: 'sha384-aaa', document: UI_DOC },
  };
  const savedFetch = window.sibStore.fetchAuthn;
  window.sibStore.fetchAuthn = async (url, init = {}) => {
    const u = String(url); calls.push([init.method ?? 'GET', u]);
    if (init.method && init.method !== 'GET') return { ok: true, status: 200, json: async () => ({}) };
    if (DATA[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => DATA[u] };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  window.appStore = { mePrefsIri: () => '/prefs/3' };
  const el = await mount();
  await new Promise((r) => setTimeout(r, 10));
  await el.updateComplete;
  const rows = [...el.shadowRoot.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 2, 'local + published aggregated');
  const localRow = rows.find((r) => r.textContent.includes('My view'));
  const pubRow = rows.find((r) => r.textContent.includes('Ticket list'));
  assert.ok(localRow.querySelector('.badge.local'), 'badge local on the local row');
  assert.ok(pubRow.querySelector('.badge.published'), 'badge published on the store row');
  assert.ok(localRow.querySelectorAll('button').length >= 2, 'Edit + Publish on a local row');
  assert.ok(pubRow.querySelectorAll('button').length >= 2, 'Edit + Unpublish on a published row');
  // Publish: integrity OK → PUT /components/my-view + POST /features/
  calls.length = 0;
  await el._publish(el.entries.find((e) => e.slug === 'my-view'));
  assert.ok(calls.some((c) => c[0] === 'PUT' && c[1] === '/components/my-view'), 'PUT enbikepe to /components/');
  const post = calls.find((c) => c[0] === 'POST' && c[1] === '/features/');
  assert.ok(post, 'POST catalogue line to /features/');
  // Unpublish: DELETE /components/ticket-list + /features/ticket-list
  calls.length = 0;
  await el._unpublish(el.entries.find((e) => e.slug === 'ticket-list'));
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/components/ticket-list'));
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/features/ticket-list'));
  // integrity failure → no PUT
  calls.length = 0;
  await el._publish({ ...el.entries.find((e) => e.slug === 'my-view'), sri: 'sha384-bad' });
  assert.ok(!calls.some((c) => c[0] === 'PUT'), 'tampered hash → nothing published');
  assert.ok(el._actionError, 'integrity error surfaced');
  el.remove();
  window.sibStore.fetchAuthn = savedFetch;
  delete window.appStore;
});

test('<my-apps> Delete removes every copy (local IRI + /components/ + /features/), confirm can cancel', async () => {
  const calls = [];
  const DATA = {
    '/users/3/components/': { 'ldp:contains': [{ '@id': '/users/3/components/my-view' }] },
    '/users/3/components/my-view': { '@id': '/users/3/components/my-view', slug: 'my-view', sri: 'sha384-x', document: LOCAL_DOC },
    '/components/': { 'ldp:contains': [{ '@id': '/components/ticket-list' }] },
    '/components/ticket-list': { '@id': '/components/ticket-list', slug: 'ticket-list', sri: 'sha384-aaa', document: UI_DOC },
  };
  const savedFetch = window.sibStore.fetchAuthn;
  window.sibStore.fetchAuthn = async (url, init = {}) => {
    const u = String(url); calls.push([init.method ?? 'GET', u]);
    if (init.method && init.method !== 'GET') return { ok: true, status: 200, json: async () => ({}) };
    if (DATA[u]) return { ok: true, status: 200, headers: { get: () => null }, json: async () => DATA[u] };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  window.appStore = { mePrefsIri: () => '/prefs/3' };
  window.confirm = () => true;
  const el = await mount();
  await new Promise((r) => setTimeout(r, 10));
  await el.updateComplete;
  // Delete button rendered on every row
  const rows = [...el.shadowRoot.querySelectorAll('tbody tr')];
  assert.ok(rows.every((r) => r.querySelector('button.danger')), 'a Delete button per row');
  // local-only row → DELETE on the pod IRI only
  calls.length = 0;
  await el._delete(el.entries.find((e) => e.slug === 'my-view'));
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/users/3/components/my-view'), 'local copy deleted');
  assert.ok(!calls.some((c) => c[0] === 'DELETE' && c[1].startsWith('/components/')), 'no store DELETE for a local-only row');
  // published row → DELETE /components/<slug> + /features/<slug>
  calls.length = 0;
  await el._delete(el.entries.find((e) => e.slug === 'ticket-list'));
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/components/ticket-list'));
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/features/ticket-list'));
  // confirm refused → nothing deleted
  window.confirm = () => false;
  calls.length = 0;
  await el._delete(el.entries[0]);
  assert.ok(!calls.some((c) => c[0] === 'DELETE'), 'cancelled confirm → no DELETE');
  el.remove();
  window.sibStore.fetchAuthn = savedFetch;
  delete window.appStore;
  delete window.confirm;
});
