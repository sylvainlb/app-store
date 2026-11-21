// TCK e2e v2 — feature distante de bout en bout contre un pod FAP-LDP live :
//   E11 (POST /admin/apps, fragment + meta v2) → catalogue /features/<slug> avec
//   cdn_url/sri/tag/version → prefs (trigger + installPatch) → loader SRI réel
//   (fetch du binaire + SHA-384, CA-A5) → révocation (DELETE /admin/apps).
//
// Lancé seulement si l'env est fournie :
//   APPSTORE_TEST_POD_URL=http://localhost \
//   APPSTORE_TEST_ADMIN_TOKEN=<token role admin> \
//   APPSTORE_TEST_TOKEN=<token user lambda> \
//   APPSTORE_TEST_PREFS_IRI=http://localhost/prefs/<pk du user lambda> \
//   npm run test:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadRemoteModule, checkSri, SriMismatchError } from '../components/shared/loader.js';
import { installPatch } from '../components/shared/logic.js';

const POD = process.env.APPSTORE_TEST_POD_URL;
const ADMIN = process.env.APPSTORE_TEST_ADMIN_TOKEN;
const TOKEN = process.env.APPSTORE_TEST_TOKEN;
const PREFS_IRI = process.env.APPSTORE_TEST_PREFS_IRI;
const SKIP = !POD || !ADMIN || !TOKEN || !PREFS_IRI;

// slug unique par run : en v1 d'E11, un slug révoqué (state='revoked') garde sa PK
// → re-POST → 409 (pas d'upgrade, spec §3.1).
const SLUG = `e2e_w${Date.now() % 1000000}`;
// "Binaire" du package de test (module ES minimal ; en node pas de customElements,
// loadRemoteModule ignore alors le check de tag).
const MODULE = 'globalThis.__e2eWidget = { ok: true };\nexport default globalThis.__e2eWidget;\n';

const headers = (tok, extra = {}) => ({ accept: 'application/ld+json', authorization: `Bearer ${tok}`, ...extra });

async function req(tok, method, url, body) {
  return fetch(url, {
    method,
    headers: headers(tok, body ? { 'content-type': 'application/ld+json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('e2e v2 : install E11 → catalogue v2 → prefs → SRI réel → révocation (CA-A5)', { skip: SKIP && 'APPSTORE_TEST_* non fournis' }, async (t) => {
  // serveur HTTP local qui sert le « binaire » du package (stand-in du CDN jsDelivr)
  const sri = 'sha384-' + Buffer.from(await crypto.subtle.digest('SHA-384', new TextEncoder().encode(MODULE))).toString('base64');
  const srv = createServer((req2, res) => {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(MODULE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cdnUrl = `http://127.0.0.1:${srv.address().port}/widget.js`;
  t.after(() => srv.close());

  // 0. idempotence : nettoyer une éventuelle installation précédente du test
  await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`).catch(() => {});

  // 1. E11 : POST /admin/apps avec meta v2 (cdn_url/sri/tag/version/npm_package)
  const post = await req(ADMIN, 'POST', `${POD}/admin/apps`, {
    slug: SLUG,
    version: '1.0.0',
    sri,
    meta: {
      title_i18n: { fr: 'Widget e2e' }, description_i18n: { fr: 'feature distante de test' },
      icon: 'widgets', menu_order: 99, route: '/widget', default_enabled: false,
      npm_package: '@test/widget', version: '1.0.0', cdn_url: cdnUrl, sri, tag: 'e2e-widget',
    },
    model_fragment: { tables: { widgets: { pk: 'id', fields: { id: { type: 'bigint', serial: true }, label: { type: 'text' } } } } },
  });
  assert.equal(post.status, 201, `POST /admin/apps → 201 (reçu ${post.status}: ${await post.clone().text()})`);
  t.after(async () => { await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`); });

  // 2. le catalogue v2 expose la feature distante complète (CA-A7 : GET par slug)
  const fiche = await req(TOKEN, 'GET', `${POD}/features/${SLUG}`);
  assert.equal(fiche.status, 200);
  const f = await fiche.json();
  const pick = (k) => f[k] ?? Object.keys(f).filter((x) => x.endsWith(':' + k)).map((x) => f[x])[0];
  assert.equal(pick('cdn_url'), cdnUrl);
  assert.equal(pick('sri'), sri);
  assert.equal(pick('tag'), 'e2e-widget');
  assert.equal(pick('version'), '1.0.0');
  assert.equal(pick('model_injected'), true); // upsert E11 (L3)

  // 3. le trigger a injecté la clé par défaut dans les prefs du user (default_enabled=false)
  const prefs0 = await (await req(TOKEN, 'GET', PREFS_IRI)).json();
  const col0 = Object.keys(prefs0).find((k) => k === 'prefs' || k.endsWith(':prefs'));
  assert.equal(prefs0[col0]?.[SLUG]?.enabled, false, 'clé par défaut injectée par le trigger');

  // 4. loader réel : fetch du binaire + SHA-384 → match → import (CA-A5 OK)
  //    (importFn via data: URL : node n'importe pas les blob: — le navigateur si)
  const importFn = async () => import('data:text/javascript;base64,' + Buffer.from(MODULE).toString('base64'));
  const loaded = await loadRemoteModule({ cdnUrl, sri, tag: 'e2e-widget' }, { importFn });
  assert.equal(loaded.module.default.ok, true);
  // sri invalide → refusé AVANT import (CA-A5)
  await assert.rejects(
    () => loadRemoteModule({ cdnUrl, sri: 'sha384-' + Buffer.alloc(48, 7).toString('base64') }, { importFn }),
    SriMismatchError);
  // checkSri direct sur le binaire fetché
  const buf = await (await fetch(cdnUrl)).arrayBuffer();
  assert.equal(await checkSri(buf, sri), true);

  // 5. installPatch persisté dans les prefs (forme R1) + read-after-write
  const etag = (await req(TOKEN, 'GET', PREFS_IRI)).headers.get('etag');
  const patch = await fetch(PREFS_IRI, {
    method: 'PATCH',
    headers: headers(TOKEN, {
      'content-type': 'application/merge-patch+json',
      ...(etag ? { 'if-match': etag } : {}),
    }),
    body: JSON.stringify({ prefs: installPatch(SLUG, '1.0.0', sri) }),
  });
  assert.ok([200, 201, 204].includes(patch.status), `PATCH prefs → ${patch.status}`);
  const after = await (await req(TOKEN, 'GET', PREFS_IRI)).json();
  const col = Object.keys(after).find((k) => k === 'prefs' || k.endsWith(':prefs'));
  assert.equal(after[col]?.[SLUG]?.installed_version, '1.0.0');
  assert.equal(after[col]?.[SLUG]?.installed_sri, sri);
  assert.equal(after[col]?.[SLUG]?.enabled, true);

  // 6. révocation E11 : DELETE /admin/apps/<slug> → 204, meta passe à revoked,
  //    et l'entrée du catalogue app.features est tombstonée (plus visible dans /features/)
  const del = await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`);
  assert.ok([204, 200].includes(del.status), `DELETE → ${del.status}`);
  const meta = await (await req(TOKEN, 'GET', `${POD}/apps/${SLUG}/meta`)).json();
  assert.equal(meta.state, 'revoked');
  const cat = await (await req(TOKEN, 'GET', `${POD}/features/`)).json();
  const slugs = (cat['ldp:contains'] ?? []).map((m) => (m['@id'] ?? '').split('/').pop());
  assert.ok(!slugs.includes(SLUG), `slug ${SLUG} retiré du catalogue après révocation`);
});

// ---------------------------------------------------------------------------
// Test 2 : install réelle d'une feature du catalogue v2 live (bundle + SRI réels).
test('e2e v2 catalogue : pv-selfconsumption — fetch bundle, SRI vérifié, élément enregistré, prefs installPatch', { skip: SKIP && 'APPSTORE_TEST_* non fournis' }, async (t) => {
  const { setupDom } = await import('./helpers/dom.js');
  setupDom(); // happy-dom : customElements/HTMLElement réels pour le bundle browser

  // sert les bundles buildés (app-features/dist) comme un CDN local
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../app-features/dist');
  const srv = createServer((req2, res) => {
    try {
      const body = readFileSync(join(distDir, decodeURIComponent(req2.url.replace(/^\/features-dist\//, '/').replace(/^\//, ''))));
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const cdnBase = `http://127.0.0.1:${srv.address().port}`;

  // fiche catalogue live (clés préfixées app_features:*)
  const fiche = await (await req(TOKEN, 'GET', `${POD}/features/pv-selfconsumption`)).json();
  const pick = (k) => fiche[k] ?? Object.keys(fiche).filter((x) => x.endsWith(':' + k)).map((x) => fiche[x])[0];
  const tag = pick('tag');
  const sri = pick('sri');
  assert.ok(tag && sri && sri.startsWith('sha384-'), 'catalogue v2 : tag + sri présents');
  const cdnUrl = cdnBase + pick('cdn_url'); // /features-dist/pv-selfconsumption.js → serveur local

  // loader réel : fetch + SHA-384 + import (import via data: URL — node n'importe pas les blob:)
  const res = await fetch(cdnUrl);
  assert.equal(res.status, 200);
  const src = await res.text();
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  const loaded = await loadRemoteModule({ cdnUrl, sri, tag }, { importFn: async () => import(dataUrl) });
  assert.ok(loaded.module, 'module importé');
  assert.ok(customElements.get(tag), `custom element <${tag}> enregistré par le bundle (CA-A5)`);

  // installPatch persisté (forme R1) + read-after-write
  const etag = (await req(TOKEN, 'GET', PREFS_IRI)).headers.get('etag');
  const patch = await fetch(PREFS_IRI, {
    method: 'PATCH',
    headers: headers(TOKEN, { 'content-type': 'application/merge-patch+json', ...(etag ? { 'if-match': etag } : {}) }),
    body: JSON.stringify({ prefs: installPatch('pv-selfconsumption', pick('version'), sri) }),
  });
  assert.ok([200, 201, 204].includes(patch.status), `PATCH prefs → ${patch.status}`);
  const after = await (await req(TOKEN, 'GET', PREFS_IRI)).json();
  const col = Object.keys(after).find((k) => k === 'prefs' || k.endsWith(':prefs'));
  assert.equal(after[col]?.['pv-selfconsumption']?.installed_sri, sri);
  assert.equal(after[col]?.['pv-selfconsumption']?.enabled, true);
});
