// TCK — <my-apps> "Mes apps" hub (route /my-apps): lists the user's published
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
  // envelope form (chantier 3 F6): { slug, sri, document }
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

test('<my-apps> "new" dispatches to /editor or /ai-editor; "edit" to ?component=<iri>', async () => {
  navEvents = [];
  const el = await mount();
  // new → AI
  const sel = el.shadowRoot.querySelector('#new-kind');
  sel.value = 'ai';
  sel.dispatchEvent(new window.Event('change'));
  assert.deepEqual(navEvents.at(-1), { route: 'ai-editor', resource: '/ai-editor', query: null });
  sel.value = 'ui';
  sel.dispatchEvent(new window.Event('change'));
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
  const sel = el.shadowRoot.querySelector('#new-kind');
  assert.ok(sel, '"New component" select still rendered when the list is empty');
  assert.ok(el.shadowRoot.querySelector('.head h1'), 'hub header rendered');
  sel.value = 'ui';
  sel.dispatchEvent(new window.Event('change'));
  assert.deepEqual(navEvents.at(-1), { route: 'ui-editor', resource: '/editor', query: null }, 'new UI component reachable from the empty state');
  el.remove();
  window.sibStore.fetchAuthn = saved;
});
