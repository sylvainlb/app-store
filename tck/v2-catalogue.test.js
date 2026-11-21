// TCK v2 — cohérence catalogue : slugs du catalogue (app-features/scripts/catalogue.json)
// ↔ seed SQL généré (app-store/sql/130_features_catalogue_v2.sql, tags de FEATURE_COMPONENTS,
// sri sha384 présents) ↔ routes déclarées dans app-supervision/orbit.json (menu:false,
// components:[] — montées à la volée via <dynamic-feature>). Check CI §1.9.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');       // app-store/
const ATLAS = join(ROOT, '..');
const catalogue = JSON.parse(readFileSync(join(ATLAS, 'app-features/scripts/catalogue.json'), 'utf8'));
const slugs = Object.keys(catalogue).filter((s) => !s.startsWith('_'));
const seedSql = readFileSync(join(ROOT, 'sql/130_features_catalogue_v2.sql'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ATLAS, 'app-features/dist/manifest.json'), 'utf8'));
const barrel = readFileSync(join(ATLAS, 'app-features/components/features/index.js'), 'utf8');
const slugToTag = Object.fromEntries([...barrel.matchAll(/'([a-z0-9-]+)':\s*'([a-z0-9-]+)'/g)].map((m) => [m[1], m[2]]));
const orbit = JSON.parse(readFileSync(join(ATLAS, 'app-supervision/orbit.json'), 'utf8'));

test('catalogue v2 : 12 features, chacune seedée en SQL avec tag + sri sha384 réels', () => {
  assert.equal(slugs.length, 12, '12 features du catalogue (lots 1–3)');
  for (const slug of slugs) {
    const tag = slugToTag[slug];
    assert.ok(tag, `slug ${slug} → tag dans FEATURE_COMPONENTS`);
    assert.ok(seedSql.includes(`('${slug}'`), `slug ${slug} présent dans 130_features_catalogue_v2.sql`);
    assert.ok(seedSql.includes(`'${tag}'`), `tag ${tag} dans le seed pour ${slug}`);
    const m = manifest.features[slug];
    assert.ok(m, `manifest: ${slug}`);
    assert.match(m.sri, /^sha384-[A-Za-z0-9+/]{64}$/, `sri sha384 de ${slug}`);
    assert.ok(seedSql.includes(m.sri), `le sri du manifest est dans le seed (${slug})`);
    assert.ok(existsSync(join(ATLAS, 'app-features/dist', slug + '.js')), `bundle dist/${slug}.js buildé`);
    assert.ok(existsSync(join(ATLAS, 'app-supervision/public/features-dist', slug + '.js')), `bundle servi en dev (public/features-dist/${slug}.js)`);
    assert.equal(m.cdn_url, `/features-dist/${slug}.js`, 'cdn_url same-origin (dev)');
  }
});

test('catalogue v2 : routes déclarées dans orbit.json (menu:false, components:[], dynamic)', () => {
  for (const slug of slugs) {
    const r = orbit.routes.find((x) => x.name === slug);
    assert.ok(r, `route ${slug} dans orbit.json`);
    assert.equal(r.path, catalogue[slug].route);
    assert.equal(r.menu, false, `${slug} hors menu statique (affiché par <app-menu> si enabled)`);
    assert.deepEqual(r.components, [], `${slug} sans composant packagé → <dynamic-feature>`);
    assert.deepEqual(r.roles, [catalogue[slug].role_min]);
  }
});

// ---------------------------------------------------------------------------
// v2 « tout par le CDN » : les features de BASE (app-supervision) sont aussi
// distantes — bundles buildés (app-supervision/scripts/build-features.mjs),
// seed 131 (colonnes v2), manifest avec sri réels. Seul `store` reste packagé
// (mécanisme d'installation, bootstrap).
test('catalogue v2 : features de base en CDN (131_base_features_v2.sql + manifest + bundles)', () => {
  const baseSlugs = ['dashboard', 'building-detail', 'anomalies', 'tickets', 'interventions', 'admin'];
  const sql131 = readFileSync(join(ATLAS, 'app-supervision-backend/sql/131_base_features_v2.sql'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(ATLAS, 'app-supervision/public/features-dist/manifest.json'), 'utf8'));
  for (const slug of baseSlugs) {
    assert.ok(sql131.includes(`slug = '${slug}'`), `131: ${slug}`);
    const m = manifest.features[slug];
    assert.ok(m, `manifest: ${slug}`);
    assert.match(m.sri, /^sha384-[A-Za-z0-9+/]{64}$/);
    assert.ok(sql131.includes(m.sri), `sri du manifest dans 131 (${slug})`);
    assert.ok(existsSync(join(ATLAS, 'app-supervision/public/features-dist', slug + '.js')), `bundle ${slug}.js`);
    assert.equal(m.cdn_url, `/features-dist/${slug}.js`);
    assert.ok(m.components.length >= 1, `tags de la route déclarés (${slug}: ${m.components.join(',')})`);
  }
  assert.ok(!sql131.includes("slug = 'store'"), 'store reste packagé (bootstrap du mécanisme app store)');
});

test('featureForPath : sous-route /tickets/new → feature tickets (match préfixe simple)', async () => {
  const { featureForPath } = await import('../components/shared/logic.js');
  const catalogue = [
    { slug: 'tickets', route: '/tickets' },
    { slug: 'building-detail', route: '/buildings/:id' },
    { slug: 'dashboard', route: '/' },
  ];
  assert.equal(featureForPath(catalogue, '/tickets/new')?.slug, 'tickets');
  assert.equal(featureForPath(catalogue, '/tickets/42')?.slug, 'tickets');
  assert.equal(featureForPath(catalogue, '/buildings/7')?.slug, 'building-detail');
  assert.equal(featureForPath(catalogue, '/')?.slug, 'dashboard');
  assert.equal(featureForPath(catalogue, '/inconnu'), null);
});

// ---------------------------------------------------------------------------
// Migration 021_features_category.sql : le backfill par slug couvre TOUS les
// slugs seedés (base 110/131 + lots 130 + catalogue app-features) → chaque feature
// du store a un rayon (sinon elle tombe dans « Other »).
test('migration 021 : backfill category couvre tous les slugs seedés', () => {
  const mig = readFileSync(join(ROOT, 'sql/021_features_category.sql'), 'utf8');
  const slugs = new Set();
  for (const f of ['110_app_store_seed.sql', '130_app_store_catalogue_v2.sql', '131_base_features_v2.sql']) {
    const sql = readFileSync(join(ATLAS, 'app-supervision-backend/sql', f), 'utf8');
    for (const m of sql.matchAll(/slug = '([a-z0-9_-]+)'/g)) slugs.add(m[1]);
    for (const m of sql.matchAll(/^\s*\('([a-z0-9_-]+)'/gm)) slugs.add(m[1]);
  }
  for (const s of Object.keys(catalogue).filter((s) => !s.startsWith('_'))) slugs.add(s);
  slugs.add('store'); // packagé, seedé dans 110
  assert.ok(slugs.size >= 19, `au moins 19 slugs seedés (reçu ${slugs.size})`);
  for (const s of slugs) {
    assert.ok(mig.includes(`'${s}'`), `slug ${s} couvert par le backfill 021`);
  }
  // colonne + index idempotents
  assert.match(mig, /ADD COLUMN IF NOT EXISTS category text/);
  assert.match(mig, /CREATE INDEX IF NOT EXISTS features_category_idx/);
});
