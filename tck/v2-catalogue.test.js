// TCK v2 — catalogue consistency: catalogue slugs (app-features/scripts/catalogue.json)
// ↔ generated seed SQL (app-store/sql/130_features_catalogue_v2.sql, FEATURE_COMPONENTS tags,
// sha384 sri present) ↔ routes declared in app-supervision/orbit.json (menu:false,
// components:[] — mounted on the fly via <dynamic-feature>). CI check §1.9.8.
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

test('v2 catalogue: 12 features, each seeded in SQL with tag + real sha384 sri', () => {
  assert.equal(slugs.length, 12, '12 catalogue features (batches 1–3)');
  for (const slug of slugs) {
    const tag = slugToTag[slug];
    assert.ok(tag, `slug ${slug} → tag in FEATURE_COMPONENTS`);
    assert.ok(seedSql.includes(`('${slug}'`), `slug ${slug} present in 130_features_catalogue_v2.sql`);
    assert.ok(seedSql.includes(`'${tag}'`), `tag ${tag} in the seed for ${slug}`);
    const m = manifest.features[slug];
    assert.ok(m, `manifest: ${slug}`);
    assert.match(m.sri, /^sha384-[A-Za-z0-9+/]{64}$/, `sha384 sri of ${slug}`);
    assert.ok(seedSql.includes(m.sri), `the manifest sri is in the seed (${slug})`);
    assert.ok(existsSync(join(ATLAS, 'app-features/dist', slug + '.js')), `bundle dist/${slug}.js built`);
    assert.ok(existsSync(join(ATLAS, 'app-supervision/public/features-dist', slug + '.js')), `bundle served in dev (public/features-dist/${slug}.js)`);
    assert.equal(m.cdn_url, `/features-dist/${slug}.js`, 'cdn_url same-origin (dev)');
  }
});

test('v2 catalogue: routes declared in orbit.json (menu:false, components:[], dynamic)', () => {
  for (const slug of slugs) {
    const r = orbit.routes.find((x) => x.name === slug);
    assert.ok(r, `route ${slug} in orbit.json`);
    assert.equal(r.path, catalogue[slug].route);
    assert.equal(r.menu, false, `${slug} out of the static menu (shown by <app-menu> if enabled)`);
    assert.deepEqual(r.components, [], `${slug} without packaged component → <dynamic-feature>`);
    assert.deepEqual(r.roles, [catalogue[slug].role_min]);
  }
});

// ---------------------------------------------------------------------------
// v2 "all via CDN": the BASE features (app-supervision) are also remote —
// bundles built (app-supervision/scripts/build-features.mjs),
// seed 131 (v2 columns), manifest with real sri. Only `store` stays packaged
// (install mechanism, bootstrap).
test('v2 catalogue: base features via CDN (131_base_features_v2.sql + manifest + bundles)', () => {
  const baseSlugs = ['dashboard', 'building-detail', 'anomalies', 'tickets', 'interventions', 'admin'];
  const sql131 = readFileSync(join(ATLAS, 'app-supervision-backend/sql/131_base_features_v2.sql'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(ATLAS, 'app-supervision/public/features-dist/manifest.json'), 'utf8'));
  for (const slug of baseSlugs) {
    assert.ok(sql131.includes(`slug = '${slug}'`), `131: ${slug}`);
    const m = manifest.features[slug];
    assert.ok(m, `manifest: ${slug}`);
    assert.match(m.sri, /^sha384-[A-Za-z0-9+/]{64}$/);
    assert.ok(sql131.includes(m.sri), `manifest sri in 131 (${slug})`);
    assert.ok(existsSync(join(ATLAS, 'app-supervision/public/features-dist', slug + '.js')), `bundle ${slug}.js`);
    assert.equal(m.cdn_url, `/features-dist/${slug}.js`);
    assert.ok(m.components.length >= 1, `route tags declared (${slug}: ${m.components.join(',')})`);
  }
  assert.ok(!sql131.includes("slug = 'store'"), 'store stays packaged (bootstrap of the app-store mechanism)');
});

test('featureForPath: sub-route /tickets/new → tickets feature (simple prefix match)', async () => {
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
  assert.equal(featureForPath(catalogue, '/unknown'), null);
});

// ---------------------------------------------------------------------------
// Migration 021_features_category.sql: the by-slug backfill covers ALL seeded
// slugs (base 110/131 + batch 130 + app-features catalogue) → every store feature
// has a category (otherwise it falls into "Other").
test('migration 021: category backfill covers all seeded slugs', () => {
  const mig = readFileSync(join(ROOT, 'sql/021_features_category.sql'), 'utf8');
  const slugs = new Set();
  for (const f of ['110_app_store_seed.sql', '130_app_store_catalogue_v2.sql', '131_base_features_v2.sql']) {
    const sql = readFileSync(join(ATLAS, 'app-supervision-backend/sql', f), 'utf8');
    for (const m of sql.matchAll(/slug = '([a-z0-9_-]+)'/g)) slugs.add(m[1]);
    for (const m of sql.matchAll(/^\s*\('([a-z0-9_-]+)'/gm)) slugs.add(m[1]);
  }
  for (const s of Object.keys(catalogue).filter((s) => !s.startsWith('_'))) slugs.add(s);
  slugs.add('store'); // packaged, seeded in 110
  assert.ok(slugs.size >= 19, `at least 19 seeded slugs (got ${slugs.size})`);
  for (const s of slugs) {
    assert.ok(mig.includes(`'${s}'`), `slug ${s} covered by the 021 backfill`);
  }
  // idempotent column + index
  assert.match(mig, /ADD COLUMN IF NOT EXISTS category text/);
  assert.match(mig, /CREATE INDEX IF NOT EXISTS features_category_idx/);
});
