// TCK — logique pure de l'app store (spec v0.4 §1.9). node --test, sans DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWebidPk, prefsPath, featureEnabled, titleOf, menuEntries,
  configDefaults, isConfigured, togglePatch, configPatch, prefsPatchBody,
  featureForPath, normalizeFieldValue, validateConfig, roleAllowed,
  groupByCategory, categoryLabel, featureMatchesQuery, CATEGORY_ORDER,
} from '../components/shared/logic.js';

const POD = 'https://pod.test';

test('§1.9.12 parseWebidPk : webid du pod → pk ; hors pod → null (interdit v1)', () => {
  assert.deepEqual(parseWebidPk('https://pod.test/users/42', POD), { pk: '42', host: 'pod.test' });
  assert.deepEqual(parseWebidPk('https://pod.test/users/42/', POD), { pk: '42', host: 'pod.test' });
  assert.equal(parseWebidPk('https://other.test/users/1', POD), null); // hors pod → 403 en v1
  assert.equal(parseWebidPk('https://pod.test/users/abc', POD), null);
  assert.equal(parseWebidPk('', POD), null);
  assert.equal(parseWebidPk(undefined, POD), null);
});

test('§1.9.12 prefsPath : /prefs/<pk>', () => {
  assert.equal(prefsPath('https://pod.test/users/42', POD), '/prefs/42');
  assert.equal(prefsPath('https://other.test/users/1', POD), null);
});

test('§1.9.4a featureEnabled : clé absente dans prefs = default_enabled', () => {
  const f = { slug: 'a', default_enabled: true };
  assert.equal(featureEnabled({}, f), true);
  assert.equal(featureEnabled({ a: { enabled: false } }, f), false);
  assert.equal(featureEnabled({ a: {} }, { slug: 'a', default_enabled: false }), false);
  assert.equal(featureEnabled(null, { slug: 'x', default_enabled: true }), true);
  assert.equal(featureEnabled({}, null), false);
});

test('§1.9.2 titleOf : locale → en → fr → slug (UI en anglais, fallback en puis fr)', () => {
  assert.equal(titleOf({ slug: 's', title_i18n: { fr: 'Titre FR', en: 'EN title' } }, 'fr'), 'Titre FR');
  assert.equal(titleOf({ slug: 's', title_i18n: { en: 'EN title' } }, 'en'), 'EN title');
  assert.equal(titleOf({ slug: 's', title_i18n: { fr: 'Titre FR' } }, 'en'), 'Titre FR'); // fallback en → fr
  assert.equal(titleOf({ slug: 's', title_i18n: {} }, 'en'), 's'); // puis slug
});

test('CA-A1 menuEntries : join catalogue×prefs, tri (menu_order, slug), enabled uniquement', () => {
  const catalogue = [
    { slug: 'c', title_i18n: { fr: 'C' }, icon: 'c', route: '/c', menu_order: 30, default_enabled: false },
    { slug: 'a', title_i18n: { fr: 'A' }, icon: 'a', route: '/a', menu_order: 10, default_enabled: true },
    { slug: 'b', title_i18n: { fr: 'B' }, icon: 'b', route: '/b', menu_order: 20, default_enabled: false },
  ];
  const prefs = { b: { enabled: true }, ghost: { enabled: true } }; // a absente → default true ; c absente → default false ; ghost ignoré (§1.9.4d)
  const entries = menuEntries(catalogue, prefs, { locale: 'fr' });
  assert.deepEqual(entries.map((e) => e.slug), ['a', 'b']); // tri menu_order
  assert.deepEqual(entries.map((e) => e.title), ['A', 'B']);
  assert.ok(!entries.some((e) => e.slug === 'ghost'));
  assert.ok(!entries.some((e) => e.slug === 'c'));
});

test('§1.4.1 role_min : correspondance exacte (comme les roles d’orbit.json) ; admin voit tout', () => {
  assert.equal(roleAllowed('all', 'technicien'), true);
  assert.equal(roleAllowed('gestionnaire', 'technicien'), false);
  assert.equal(roleAllowed('technicien', 'technicien'), true);
  assert.equal(roleAllowed('gestionnaire', 'gestionnaire'), true);
  assert.equal(roleAllowed('gestionnaire', 'admin'), true);   // l'utilisateur admin voit tout
  assert.equal(roleAllowed('admin', 'admin'), true);
  assert.equal(roleAllowed('admin', 'gestionnaire'), false);  // un gestionnaire ne voit pas une feature admin
  assert.equal(roleAllowed('technicien', undefined), false); // rôle inconnu → non autorisé (sauf 'all')

  const catalogue = [
    { slug: 'dash', route: '/', menu_order: 1, default_enabled: true, role_min: 'all' },
    { slug: 'tickets', route: '/tickets', menu_order: 2, default_enabled: true, role_min: 'gestionnaire' },
    { slug: 'admin', route: '/admin', menu_order: 3, default_enabled: true, role_min: 'admin' },
  ];
  assert.deepEqual(menuEntries(catalogue, {}, { role: 'technicien' }).map((e) => e.slug), ['dash']);
  assert.deepEqual(menuEntries(catalogue, {}, { role: 'gestionnaire' }).map((e) => e.slug), ['dash', 'tickets']);
  assert.deepEqual(menuEntries(catalogue, {}, { role: 'admin' }).map((e) => e.slug), ['dash', 'tickets', 'admin']);
  // champ préfixé JSON-LD (features:role_min) aussi reconnu
  assert.deepEqual(menuEntries([{ slug: 'x', route: '/x', menu_order: 1, default_enabled: true, 'features:role_min': 'admin' }], {}, { role: 'gestionnaire' }), []);
});

test('CA-A1 menuEntries : routeExists filtre les features sans route dans orbit.json (§1.9.8)', () => {
  const catalogue = [
    { slug: 'a', route: '/a', menu_order: 1, default_enabled: true },
    { slug: 'b', route: '/b', menu_order: 2, default_enabled: true },
  ];
  const entries = menuEntries(catalogue, {}, { routeExists: (f) => f.route === '/a' });
  assert.deepEqual(entries.map((e) => e.slug), ['a']);
});

test('§1.9.6 configDefaults + §1.9.11 isConfigured (non vide ET ≠ defaults)', () => {
  const schema = { fields: [
    { key: 'budget_kwh', type: 'number', default: 100 },
    { key: 'alert_pct', type: 'number', default: 80 },
  ] };
  assert.deepEqual(configDefaults(schema), { budget_kwh: 100, alert_pct: 80 });
  assert.equal(isConfigured({}, schema), false);
  assert.equal(isConfigured({ budget_kwh: 100, alert_pct: 80 }, schema), false); // = defaults → pas « configuré »
  assert.equal(isConfigured({ budget_kwh: 120 }, schema), true);
});

test('forme R1 §1.5 : togglePatch/configPatch/prefsPatchBody — jsonb NON aplati à la racine', () => {
  assert.deepEqual(togglePatch('building-map', false), { 'building-map': { enabled: false } });
  assert.deepEqual(configPatch('budget-tracker', { budget_kwh: 500 }), { 'budget-tracker': { config: { budget_kwh: 500 } } });
  assert.deepEqual(prefsPatchBody(togglePatch('building-map', false)), { prefs: { 'building-map': { enabled: false } } });
});

test('§1.9.7 featureForPath : match exact + route avec :param', () => {
  const catalogue = [
    { slug: 'tickets', route: '/tickets' },
    { slug: 'ticket-detail', route: '/tickets/:id' },
    { slug: 'home', route: '/' },
  ];
  assert.equal(featureForPath(catalogue, '/tickets')?.slug, 'tickets');
  assert.equal(featureForPath(catalogue, '/tickets/42')?.slug, 'ticket-detail');
  assert.equal(featureForPath(catalogue, '/')?.slug, 'home');
  assert.equal(featureForPath(catalogue, '/inconnu'), null);
});

test('§1.9.6 normalizeFieldValue + validateConfig (validation front v1, CA-A3)', () => {
  assert.equal(normalizeFieldValue({ type: 'number' }, '42'), 42);
  assert.equal(normalizeFieldValue({ type: 'number' }, 'abc'), undefined);
  assert.equal(normalizeFieldValue({ type: 'boolean' }, 1), true);
  assert.deepEqual(normalizeFieldValue({ type: 'array' }, 'a\nb, c'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeFieldValue({ type: 'array' }, '["x","y"]'), ['x', 'y']);
  assert.deepEqual(normalizeFieldValue({ type: 'object' }, '{"k":1}'), { k: 1 });
  assert.equal(normalizeFieldValue({ type: 'enum', options: ['a', 'b'] }, 'z'), undefined);

  const schema = { fields: [
    { key: 'budget_kwh', type: 'number', required: true },
    { key: 'format', type: 'enum', options: ['pdf', 'csv'] },
  ] };
  assert.deepEqual(validateConfig(schema, { budget_kwh: 100, format: 'pdf' }), { ok: true, errors: {} });
  assert.equal(validateConfig(schema, { format: 'pdf' }).ok, false);           // required
  assert.equal(validateConfig(schema, { budget_kwh: 'x' }).ok, false);         // pas un number après normalize → undefined → required
  assert.equal(validateConfig(schema, { budget_kwh: 1, format: 'json' }).errors.format, 'not_in_options');
});

// ---------------------------------------------------------------- §1.6.2 révisée
// Organisation du store par catégorie (colonne app.features.category, migration 021).
test('groupByCategory : ordre fixe CATEGORY_ORDER, inconnues alpha, sans catégorie en dernier', () => {
  const features = [
    { slug: 'b', category: 'energy' },
    { slug: 'a' },                                  // sans catégorie
    { slug: 'c', category: 'supervision' },
    { slug: 'd', category: 'zzz' },                 // catégorie inconnue
    { slug: 'e', category: 'tools' },
  ];
  const groups = groupByCategory(features, 'en');
  assert.deepEqual(groups.map((g) => g.category), ['supervision', 'energy', 'tools', 'zzz', '']);
  assert.deepEqual(groups.map((g) => g.label), ['Supervision', 'Energy & optimization', 'Tools', 'zzz', 'Other']);
  assert.deepEqual(groups[0].features.map((f) => f.slug), ['c']);
  assert.deepEqual(groups.at(-1).features.map((f) => f.slug), ['a']);
  assert.deepEqual(groupByCategory([], 'en'), []);
  assert.deepEqual(groupByCategory(null, 'en'), []);
  // ordre par défaut de CATEGORY_ORDER cohérent
  assert.deepEqual(CATEGORY_ORDER, ['supervision', 'operations', 'energy', 'compliance', 'tools']);
});

test('categoryLabel : i18n en/fr, fallback sur la valeur brute', () => {
  assert.equal(categoryLabel('energy', 'en'), 'Energy & optimization');
  assert.equal(categoryLabel('energy', 'fr'), 'Énergie & optimisation');
  assert.equal(categoryLabel('', 'en'), 'Other');
  assert.equal(categoryLabel('custom-cat', 'en'), 'custom-cat');
});

test('featureMatchesQuery : recherche sur slug/titre/description, insensible à la casse', () => {
  const f = { slug: 'pv-selfconsumption', title_i18n: { en: 'PV self-consumption' }, description_i18n: { en: 'Rate of self-consumption.' } };
  assert.equal(featureMatchesQuery(f, ''), true);
  assert.equal(featureMatchesQuery(f, '  '), true);
  assert.equal(featureMatchesQuery(f, 'PV SELF'), true);       // titre
  assert.equal(featureMatchesQuery(f, 'self-consumption'), true); // slug (titre aussi)
  assert.equal(featureMatchesQuery(f, 'rate of'), true);       // description
  assert.equal(featureMatchesQuery(f, 'budget'), false);
});
