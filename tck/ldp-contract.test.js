// TCK e2e — contrat LDP réel contre un pod FAP-LDP (CA-A2, CA-A7).
// Lancé seulement si l'env est fournie :
//   APPSTORE_TEST_POD_URL=https://<pod> APPSTORE_TEST_TOKEN=<bearer> \
//   APPSTORE_TEST_PREFS_IRI=https://<pod>/prefs/<pk> \
//   APPSTORE_TEST_OTHER_PREFS_IRI=https://<pod>/prefs/<autre_pk> \
//   npm run test:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';

const POD = process.env.APPSTORE_TEST_POD_URL;
const TOKEN = process.env.APPSTORE_TEST_TOKEN;
const PREFS_IRI = process.env.APPSTORE_TEST_PREFS_IRI;
const OTHER_IRI = process.env.APPSTORE_TEST_OTHER_PREFS_IRI;
const SKIP = !POD || !TOKEN || !PREFS_IRI || !OTHER_IRI;

const headers = { accept: 'application/ld+json', authorization: `Bearer ${TOKEN}` };

async function req(method, url, body, extra = {}) {
  return fetch(url, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/merge-patch+json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('contrat LDP app store (e2e)', { skip: SKIP && 'APPSTORE_TEST_* non fournis' }, async () => {
  // CA-A7 : GET /features/<slug> résolu par slug (lookup slug→id côté PEP)
  const cat = await req('GET', `${POD}/features/`);
  assert.equal(cat.status, 200);
  const container = await cat.json();
  const slugs = (container['ldp:contains'] ?? []).map((m) => (m['@id'] ?? '').split('/').pop());
  assert.ok(slugs.length > 0, 'catalogue non vide');
  const slug = slugs[0];
  const fiche = await req('GET', `${POD}/features/${slug}`);
  assert.equal(fiche.status, 200, `GET /features/${slug} → 200 (CA-A7)`);
  const f = await fiche.json();
  assert.equal(f.slug ?? f['features:slug'] ?? f['@id']?.split('/').pop(), slug);

  // CA-A2 : PATCH forme R1 sur mes prefs → 200 + read-after-write.
  // Le serveur REMPLACE la colonne jsonb entière (§1.5 RMW) → on envoie l'objet complet
  // fusionné (merge par slug), protégé par If-Match. La colonne est sérialisée avec un
  // préfixe (`app_prefs:prefs` en live) → lecture générique de la clé `*:prefs`.
  const colKeyOf = (data) => Object.keys(data).find((k) => k === 'prefs' || k.endsWith(':prefs'));
  const getRes = await req('GET', PREFS_IRI);
  const etag = getRes.headers.get('etag');
  const current = await getRes.json();
  const colKey = colKeyOf(current) ?? 'prefs';
  const currentPrefs = (colKey && current[colKey]) || {};
  const body = { prefs: { ...currentPrefs, [slug]: { ...(currentPrefs[slug] ?? {}), enabled: false } } };
  const patch = await req('PATCH', PREFS_IRI, body, etag ? { 'if-match': etag } : {});
  assert.ok([200, 201, 204].includes(patch.status), `PATCH /prefs → ${patch.status}`);
  const after = await req('GET', PREFS_IRI);
  assert.equal(after.status, 200);
  const prefs = await after.json();
  const entry = prefs[colKeyOf(prefs)]?.[slug];
  assert.equal(entry?.enabled, false, 'read-after-write : enabled=false persisté');

  // CA-A2 : un autre utilisateur ne voit pas mes prefs → 403 uniforme (§1.9.10 révisée :
  // le PDP rend 403 avant la RLS, même pour un IRI inexistant — ne divulgue pas l'existence)
  const other = await req('GET', OTHER_IRI);
  assert.equal(other.status, 403, `GET prefs d'un autre user → 403 (reçu ${other.status})`);
});
