// TCK e2e v2 — remote feature end to end against a live FAP-LDP pod:
//   E11 (POST /admin/apps, fragment + v2 meta) → catalogue /features/<slug> with
//   cdn_url/sri/tag/version → prefs (trigger + installPatch) → real SRI loader
//   (fetch of the binary + SHA-384, CA-A5) → revocation (DELETE /admin/apps).
//
// Run only if the env is provided:
//   APPSTORE_TEST_POD_URL=http://localhost \
//   APPSTORE_TEST_ADMIN_TOKEN=<admin role token> \
//   APPSTORE_TEST_TOKEN=<regular user token> \
//   APPSTORE_TEST_PREFS_IRI=http://localhost/prefs/<pk of the regular user> \
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

// unique slug per run: in E11 v1, a revoked slug (state='revoked') keeps its PK
// → re-POST → 409 (no upgrade, spec §3.1).
const SLUG = `e2e_w${Date.now() % 1000000}`;
// test package "binary" (minimal ES module; in node there is no customElements,
// loadRemoteModule then skips the tag check).
const MODULE = 'globalThis.__e2eWidget = { ok: true };\nexport default globalThis.__e2eWidget;\n';

const headers = (tok, extra = {}) => ({ accept: 'application/ld+json', authorization: `Bearer ${tok}`, ...extra });

async function req(tok, method, url, body) {
  return fetch(url, {
    method,
    headers: headers(tok, body ? { 'content-type': 'application/ld+json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('e2e v2: E11 install → v2 catalogue → prefs → real SRI → revocation (CA-A5)', { skip: SKIP && 'APPSTORE_TEST_* not provided' }, async (t) => {
  // local HTTP server serving the test package "binary" (stand-in for the jsDelivr CDN)
  const sri = 'sha384-' + Buffer.from(await crypto.subtle.digest('SHA-384', new TextEncoder().encode(MODULE))).toString('base64');
  const srv = createServer((req2, res) => {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(MODULE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cdnUrl = `http://127.0.0.1:${srv.address().port}/widget.js`;
  t.after(() => srv.close());

  // 0. idempotency: clean up any previous install of this test
  await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`).catch(() => {});

  // 1. E11: POST /admin/apps with v2 meta (cdn_url/sri/tag/version/npm_package)
  const post = await req(ADMIN, 'POST', `${POD}/admin/apps`, {
    slug: SLUG,
    version: '1.0.0',
    sri,
    meta: {
      title_i18n: { en: 'E2E widget', fr: 'Widget e2e' }, description_i18n: { en: 'Remote test feature', fr: 'Feature distante de test' },
      icon: 'widgets', menu_order: 99, route: '/widget', default_enabled: false,
      npm_package: '@test/widget', version: '1.0.0', cdn_url: cdnUrl, sri, tag: 'e2e-widget',
    },
    model_fragment: { tables: { widgets: { pk: 'id', fields: { id: { type: 'bigint', serial: true }, label: { type: 'text' } } } } },
  });
  assert.equal(post.status, 201, `POST /admin/apps → 201 (got ${post.status}: ${await post.clone().text()})`);
  t.after(async () => { await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`); });

  // 2. the v2 catalogue exposes the complete remote feature (CA-A7: GET by slug)
  const fiche = await req(TOKEN, 'GET', `${POD}/features/${SLUG}`);
  assert.equal(fiche.status, 200);
  const f = await fiche.json();
  const pick = (k) => f[k] ?? Object.keys(f).filter((x) => x.endsWith(':' + k)).map((x) => f[x])[0];
  assert.equal(pick('cdn_url'), cdnUrl);
  assert.equal(pick('sri'), sri);
  assert.equal(pick('tag'), 'e2e-widget');
  assert.equal(pick('version'), '1.0.0');
  assert.equal(pick('model_injected'), true); // E11 upsert (L3)

  // 3. the trigger injected the default key into the user's prefs (default_enabled=false)
  const prefs0 = await (await req(TOKEN, 'GET', PREFS_IRI)).json();
  const col0 = Object.keys(prefs0).find((k) => k === 'prefs' || k.endsWith(':prefs'));
  assert.equal(prefs0[col0]?.[SLUG]?.enabled, false, 'default key injected by the trigger');

  // 4. real loader: fetch of the binary + SHA-384 → match → import (CA-A5 OK)
  //    (importFn via data: URL: node does not import blob: — the browser does)
  const importFn = async () => import('data:text/javascript;base64,' + Buffer.from(MODULE).toString('base64'));
  const loaded = await loadRemoteModule({ cdnUrl, sri, tag: 'e2e-widget' }, { importFn });
  assert.equal(loaded.module.default.ok, true);
  // invalid sri → refused BEFORE import (CA-A5)
  await assert.rejects(
    () => loadRemoteModule({ cdnUrl, sri: 'sha384-' + Buffer.alloc(48, 7).toString('base64') }, { importFn }),
    SriMismatchError);
  // checkSri directly on the fetched binary
  const buf = await (await fetch(cdnUrl)).arrayBuffer();
  assert.equal(await checkSri(buf, sri), true);

  // 5. installPatch persisted in the prefs (form R1) + read-after-write
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

  // 6. E11 revocation: DELETE /admin/apps/<slug> → 204, meta goes to revoked,
  //    and the app.features catalogue entry is tombstoned (no longer visible in /features/)
  const del = await req(ADMIN, 'DELETE', `${POD}/admin/apps/${SLUG}`);
  assert.ok([204, 200].includes(del.status), `DELETE → ${del.status}`);
  const meta = await (await req(TOKEN, 'GET', `${POD}/apps/${SLUG}/meta`)).json();
  assert.equal(meta.state, 'revoked');
  const cat = await (await req(TOKEN, 'GET', `${POD}/features/`)).json();
  const slugs = (cat['ldp:contains'] ?? []).map((m) => (m['@id'] ?? '').split('/').pop());
  assert.ok(!slugs.includes(SLUG), `slug ${SLUG} removed from the catalogue after revocation`);
});

// ---------------------------------------------------------------------------
// Test 2: real install of a live v2 catalogue feature (real bundle + SRI).
test('e2e v2 catalogue: pv-selfconsumption — fetch bundle, SRI verified, element registered, prefs installPatch', { skip: SKIP && 'APPSTORE_TEST_* not provided' }, async (t) => {
  const { setupDom } = await import('./helpers/dom.js');
  setupDom(); // happy-dom: real customElements/HTMLElement for the browser bundle

  // serves the built bundles (app-features/dist) like a local CDN
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

  // live catalogue record (prefixed keys app_features:*)
  const fiche = await (await req(TOKEN, 'GET', `${POD}/features/pv-selfconsumption`)).json();
  const pick = (k) => fiche[k] ?? Object.keys(fiche).filter((x) => x.endsWith(':' + k)).map((x) => fiche[x])[0];
  const tag = pick('tag');
  const sri = pick('sri');
  assert.ok(tag && sri && sri.startsWith('sha384-'), 'v2 catalogue: tag + sri present');
  const cdnUrl = cdnBase + pick('cdn_url'); // /features-dist/pv-selfconsumption.js → local server

  // real loader: fetch + SHA-384 + import (import via data: URL — node does not import blob:)
  const res = await fetch(cdnUrl);
  assert.equal(res.status, 200);
  const src = await res.text();
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  const loaded = await loadRemoteModule({ cdnUrl, sri, tag }, { importFn: async () => import(dataUrl) });
  assert.ok(loaded.module, 'module imported');
  assert.ok(customElements.get(tag), `custom element <${tag}> registered by the bundle (CA-A5)`);

  // installPatch persisted (form R1) + read-after-write
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
