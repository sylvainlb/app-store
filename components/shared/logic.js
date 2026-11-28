// PURE app-store logic (no DOM, testable with node --test) — spec v0.4 §1.4–§1.9.
// Kept separate from the Lit components (logic.js pattern of the business components).

// ---------------------------------------------------------------------------
// §1.9.12 — <me>: pk extracted from the webid claim (https://<pod>/users/<pk>).
// A webid OUTSIDE the pod is forbidden in v1 → null.
// Returns { pk, host } or null.
export function parseWebidPk(webid, podUrl) {
  if (!webid || typeof webid !== 'string') return null;
  let u;
  try { u = new URL(webid); } catch { return null; }
  if (podUrl) {
    let pod;
    try { pod = new URL(podUrl); } catch { return null; }
    if (u.origin !== pod.origin) return null; // webid outside the pod → forbidden in v1 (403)
  }
  const m = u.pathname.match(/^\/users\/(\d+)\/?$/);
  if (!m) return null;
  return { pk: m[1], host: u.host };
}

// IRI (relative path, resolved against POD_URL by fetchAuthn) of <me>'s prefs.
export function prefsPath(webid, podUrl) {
  const p = parseWebidPk(webid, podUrl);
  return p ? `/prefs/${p.pk}` : null;
}

// ---------------------------------------------------------------------------
// §1.9.4a — rule "key absent from prefs = default_enabled".
// prefsObj = content of the jsonb prefs column: {"<slug>": {"enabled":…, "config":…}}
export function featureEnabled(prefsObj, feature) {
  if (!feature) return false;
  const slug = get(feature, 'slug');
  const entry = prefsObj?.[slug];
  if (entry && typeof entry.enabled === 'boolean') return entry.enabled;
  return !!get(feature, 'default_enabled');
}

// ---------------------------------------------------------------------------
// Localized title §1.9.2: title_i18n[locale] → fallback en → fallback fr → fallback slug.
export function titleOf(feature, locale = 'en') {
  const t = get(feature, 'title_i18n') ?? {};
  return t[locale] ?? t.en ?? t.fr ?? get(feature, 'slug') ?? '';
}

// ---------------------------------------------------------------------------
// §1.6.1 / CA-A1 — menu entries: join catalogue × prefs, sort
// (menu_order ASC, slug ASC) (§1.9.1), prefs slugs unknown to the catalogue
// ignored (§1.9.4d). routeExists(slug/route) filters out features whose route
// does not exist in orbit.json (§1.9.8).
export function menuEntries(catalogue, prefsObj, { locale = 'en', routeExists, role } = {}) {
  const knownSlugs = new Set((prefsObj ? Object.keys(prefsObj) : []));
  return (catalogue ?? [])
    .filter((f) => !routeExists || routeExists(f))
    // parameterized route (e.g. /buildings/:id) = DETAIL page: reached by clicking
    // an item, never displayed as-is in the menu (without id → 404).
    .filter((f) => !String(get(f, 'route') ?? '').includes(':'))
    .filter((f) => (get(f, 'in_menu') ?? true) !== false) // in_menu=false → out of the menu (tool e.g. /store), route still guarded
    .filter((f) => roleAllowed(get(f, 'role_min') ?? 'all', role))
    .map((f) => ({
      slug: get(f, 'slug'),
      title: titleOf(f, locale),
      icon: get(f, 'icon') || 'extension',
      route: get(f, 'route'),
      enabled: featureEnabled(prefsObj, f),
      // §1.9.4d: a prefs entry without a catalogue feature is ignored —
      // we only render catalogue features (knownSlugs is used by the
      // non-regression tests: menuEntries never produces a slug outside the catalogue).
      _known: knownSlugs.has(f.slug) || Object.keys(prefsObj ?? {}).length === 0,
    }))
    .filter((e) => e.enabled)
    .sort((a, b) => {
      const fa = catalogue.find((f) => get(f, 'slug') === a.slug);
      const fb = catalogue.find((f) => get(f, 'slug') === b.slug);
      return ((get(fa, 'menu_order') ?? 0) - (get(fb, 'menu_order') ?? 0)) || a.slug.localeCompare(b.slug);
    });
}

// Reads a JSON-LD field whatever its prefix (features:role_min, role_min…).
export function get(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[name] !== undefined) return obj[name];
  for (const k of Object.keys(obj)) if (k.endsWith(':' + name)) return obj[k];
  return undefined;
}

// ---------------------------------------------------------------------------
// §1.4.1 — role_min: 'all' | 'technician' | 'manager' | 'admin'.
// EXACT match (like the "roles" of orbit.json routes):
// visible if role_min == 'all', or role_min == the user's role, or admin.
// (Menu + guard filtering only — security stays server-side ACL/PDP.)
export function roleAllowed(roleMin, role) {
  if (!roleMin || roleMin === 'all') return true;
  if (role === 'admin') return true;
  return roleMin === role;
}

// ---------------------------------------------------------------------------
// §1.9.6 — config_schema meta-schema:
// {"fields": [{"key","label","type":"string"|"number"|"boolean"|"enum"|"object"|"array",
//              "default"?,"options"? (enum),"items"? (array),"required"?}]}
export function configDefaults(schema) {
  const out = {};
  for (const f of schema?.fields ?? []) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

// §1.9.11 — "configured" badge: config non-empty AND different from the defaults
// (JSON comparison).
export function isConfigured(config, schema) {
  if (!config || typeof config !== 'object' || Object.keys(config).length === 0) return false;
  return JSON.stringify(config) !== JSON.stringify(configDefaults(schema));
}

// ---------------------------------------------------------------------------
// Form R1 of the PATCHes (§1.5): the prefs jsonb is NOT flattened at the root —
// body = {"prefs": {…}}.
export function togglePatch(slug, enabled) {
  return { [slug]: { enabled: !!enabled } };
}
export function configPatch(slug, config) {
  return { [slug]: { config } };
}

/**
 * Extracts the jsonb `prefs` column from a JSON-LD resource, whatever the
 * server's serialization prefix (`prefs`, `prefs:prefs`, `app_prefs:prefs`…).
 */
export function prefsColumn(data) {
  if (!data || typeof data !== 'object') return {};
  for (const k of Object.keys(data)) {
    if (k === 'prefs' || k.endsWith(':prefs')) {
      if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) return data[k];
    }
  }
  return {};
}

/**
 * PATCH body form R1: {"prefs": {…}}. Observed on the live server (21/11): the PEP
 * REPLACES the whole jsonb `prefs` column (no deep server-side merge) →
 * read-modify-write: we merge the patch with the current state (merge by slug, to
 * preserve `config` when only touching `enabled`) and send the complete object,
 * protected by If-Match → 412 on conflict (§1.9.9).
 */
export function prefsPatchBody(patch, current = {}) {
  const merged = { ...current };
  for (const [slug, val] of Object.entries(patch ?? {})) {
    merged[slug] = { ...(current?.[slug] ?? {}), ...(val ?? {}) };
  }
  return { prefs: merged };
}

// ---------------------------------------------------------------------------
// Route guard (§1.9.7 / CA-A4): finds the feature whose Orbit route
// matches the requested path. Exact match, or prefix if the route has a :param
// (e.g. route "/buildings/:id", path "/buildings/42").
export function featureForPath(catalogue, pathname) {
  if (!pathname) return null;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  for (const f of catalogue ?? []) {
    const route = get(f, 'route');
    if (!route) continue;
    const r = route.replace(/\/+$/, '') || '/';
    if (r === path) return f;
  }
  for (const f of catalogue ?? []) {
    const route = get(f, 'route');
    if (!route || !route.includes(':')) continue;
    const base = route.split(':')[0].replace(/\/+$/, '');
    if (base && (path === base || path.startsWith(base + '/'))) return f;
  }
  // 3rd pass: simple prefix (sub-route of a feature, e.g. /tickets/new → tickets feature)
  for (const f of catalogue ?? []) {
    const route = get(f, 'route');
    if (!route || route.includes(':')) continue;
    const base = route.replace(/\/+$/, '') || '/';
    if (base !== '/' && path.startsWith(base + '/')) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config form (front-end validation v1, §1.9.6 / CA-A3).

// Normalizes an entered value according to the field type.
export function normalizeFieldValue(fieldDef, raw) {
  switch (fieldDef.type) {
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return !!raw;
    case 'enum':
      return fieldDef.options?.includes(raw) ? raw : undefined;
    case 'array':
      // text input: one value per line (or JSON array)
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === 'string') {
        const s = raw.trim();
        if (s.startsWith('[')) {
          try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : undefined; } catch { return undefined; }
        }
        return s ? s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) : [];
      }
      return undefined;
    case 'object':
      if (typeof raw === 'object' && raw !== null) return raw;
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try { return JSON.parse(raw); } catch { return undefined; }
      }
      return undefined;
    case 'string':
    default:
      return raw === '' || raw === null || raw === undefined ? undefined : String(raw);
  }
}

// Validates a config object against the schema → { ok, errors: {key: message} }.
export function validateConfig(schema, values) {
  const errors = {};
  const fields = schema?.fields ?? [];
  for (const f of fields) {
    const v = values?.[f.key];
    if (f.required && (v === undefined || v === null || v === '')) {
      errors[f.key] = 'required';
      continue;
    }
    if (v === undefined) continue;
    if (f.type === 'enum' && f.options && !f.options.includes(v)) errors[f.key] = 'not_in_options';
    if (f.type === 'number' && typeof v !== 'number') errors[f.key] = 'not_a_number';
    if (f.type === 'boolean' && typeof v !== 'boolean') errors[f.key] = 'not_a_boolean';
    if (f.type === 'array' && !Array.isArray(v)) errors[f.key] = 'not_an_array';
    if (f.type === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) errors[f.key] = 'not_an_object';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Part 2 (v2) — remote features: pure helpers.

// A feature is "remote" if the v2 catalogue carries cdn_url + tag
// (columns of 020_features_v2.sql); otherwise it is packaged at build time (v1).
export function isDistant(feature) {
  return !!(get(feature, 'cdn_url') && get(feature, 'tag'));
}

// Prefs entry of a feature (jsonb prefs.<slug>): {enabled, config, installed_version?, installed_sri?}.
export function installedEntry(prefsObj, slug) {
  return prefsObj?.[slug] ?? {};
}

// v0.5 — two-stage store (spec v0.5 §1.4.3, J8): stage discriminant on the catalogue line.
// 'code' (default, the 12 existing features) = distant SRI bundle, unchanged.
// 'declarative' = JSON-LD document interpreted by <cmp-runtime> (workstream 3).
export function isDeclarative(feature) {
  return get(feature, 'stage') === 'declarative';
}

// CA-A5: a packaged feature is always "installed" (present at build time);
// a remote feature is only if installed_version + installed_sri are set.
// v0.5: a DECLARATIVE feature is installed only if the document hash was verified
// and recorded (installed_version = document_iri, installed_sri = document hash).
export function isInstalled(feature, prefsObj) {
  if (isDeclarative(feature)) {
    const e = installedEntry(prefsObj, get(feature, 'slug'));
    return !!(e.installed_version && e.installed_sri);
  }
  if (!isDistant(feature)) return true;
  const e = installedEntry(prefsObj, get(feature, 'slug'));
  return !!(e.installed_version && e.installed_sri);
}

// v0.5 §1.4.3 — routes of INSTALLED declarative features, merged into the host shell's
// route table at boot (orbit.json stays untouched for the code stage; CA-A8).
export function declarativeRoutes(catalogue, prefsObj) {
  return (catalogue ?? [])
    .filter((f) => isDeclarative(f) && featureEnabled(prefsObj, f))
    .map((f) => ({
      name: get(f, 'slug'),
      path: get(f, 'route'),
      roles: [get(f, 'role_min') ?? 'all'],
      menu: get(f, 'in_menu') ?? true,
      dynamic: true,
    }));
}

// "x.y.z" version comparison (dotted integers): -1 / 0 / 1.
export function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// CA-A6: the catalogue announces a version > installed_version → upgrade offered
// (re-verification of the new sri at upgrade time, §2.2.5).
export function upgradeAvailable(feature, prefsObj) {
  if (!isDistant(feature)) return false;
  const e = installedEntry(prefsObj, get(feature, 'slug'));
  const v = get(feature, 'version');
  return !!(v && e.installed_version && compareVersions(v, e.installed_version) > 0);
}

// Install patch (form R1 §1.5): enables the feature AND records the
// actually-loaded version (front-end audit; the server audit is in dsp.audit via E11).
export function installPatch(slug, version, sri) {
  return { [slug]: { enabled: true, installed_version: version, installed_sri: sri } };
}

// Uninstall patch (§2.2.4): disables + nullifies installed_* (null keys are
// removed by the RFC 7386 merge-patch / the complete object sent).
export function uninstallPatch(slug) {
  return { [slug]: { enabled: false, installed_version: null, installed_sri: null } };
}

// ---------------------------------------------------------------------------
// Store organization (revised spec §1.6.2): categories (sections) + search.
// The app.features.category column (migration 021) holds 'supervision',
// 'operations', 'energy', 'compliance', 'tools'… or NULL (→ "Other" section).
// The menu (<app-menu>) stays flat: categorization only lives in /store.
export const CATEGORY_ORDER = ['supervision', 'operations', 'energy', 'compliance', 'tools'];

export const CATEGORY_LABELS = {
  en: { supervision: 'Supervision', operations: 'Operations', energy: 'Energy & optimization', compliance: 'Compliance & reporting', tools: 'Tools', _other: 'Other' },
  fr: { supervision: 'Supervision', operations: 'Exploitation', energy: 'Énergie & optimisation', compliance: 'Conformité & reporting', tools: 'Outils', _other: 'Autres' },
};

export function categoryLabel(cat, locale = 'en') {
  const labels = CATEGORY_LABELS[locale] ?? CATEGORY_LABELS.en;
  if (!cat) return labels._other;
  return labels[cat] ?? cat;
}

// Groups features by category: fixed CATEGORY_ORDER, unknown ones
// alphabetically, no category ('') always last.
export function groupByCategory(features, locale = 'en') {
  const byCat = new Map();
  for (const f of features ?? []) {
    const c = String(get(f, 'category') ?? '');
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(f);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
  return cats.map((c) => ({ category: c, label: categoryLabel(c, locale), features: byCat.get(c) }));
}

// Text search on slug + title + description (case-insensitive).
export function featureMatchesQuery(f, query, locale = 'en') {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const desc = get(f, 'description_i18n') ?? {};
  const hay = [get(f, 'slug'), titleOf(f, locale), desc[locale] ?? desc.en ?? desc.fr ?? '']
    .join(' ').toLowerCase();
  return hay.includes(q);
}

// ---------------------------------------------------------------------------
// "Mes apps" hub (route /my-apps) — the user's OWN components published in the
// /components/ container (declarative stage of the app store, workstream 3 J12),
// UI and AI together (workstreams 3 + 4/5). The hub lists them and dispatches to
// the right editor; /editor and /ai-editor stay as deep links.

// fap-ldp serves resource fields with the table prefix (app_user_components:slug,
// app_user_components:document…); fixtures and tests use plain keys. Accept both.
function fieldOf(res, local) {
  if (res[local] !== undefined) return res[local];
  for (const k of Object.keys(res)) {
    if (k.endsWith(':' + local)) return res[k];
  }
  return undefined;
}

// Unwrap a /components/<slug> resource into { iri, slug, sri, doc }. The stored
// resource is the envelope { slug, sri, document } (workstream 3 F6), served with
// prefixed keys by fap-ldp; a raw component document is also accepted (tests,
// fixtures).
export function unwrapComponentResource(res) {
  if (!res || typeof res !== 'object') return null;
  let doc = fieldOf(res, 'document');
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { doc = null; }
  }
  if (!doc || typeof doc !== 'object') doc = res;
  const types = doc['@type'] ?? res['@type'];
  if (!types) return null;
  const slug = fieldOf(res, 'slug')
    ?? (typeof doc['@id'] === 'string' ? doc['@id'].split('/').filter(Boolean).pop() : null);
  return {
    iri: res['@id'] ?? doc['@id'] ?? null,
    slug,
    sri: fieldOf(res, 'sri') ?? null,
    doc,
  };
}

// 'ai' for cmp:AiComponent (workstream 4/5), 'ui' for the UI primitives (workstream 3
// R1.6), null when the document is not a published component.
export function componentKind(doc) {
  const t = doc?.['@type'];
  if (t === 'cmp:AiComponent') return 'ai';
  if (['cmp:ListComponent', 'cmp:DetailComponent', 'cmp:FormComponent', 'cmp:AiBlockComponent'].includes(t)) return 'ui';
  return null;
}

// Localized label of a component document (R1.3: pivot en, locales otherwise).
export function componentLabel(doc, locale = 'en') {
  const t = doc?.['cmp:label'] ?? {};
  if (typeof t === 'string') return t;
  return t[locale] ?? t.en ?? t.fr ?? doc?.['@id'] ?? '';
}

// Deep link reopening a published component in its editor as a derived draft
// (F7.3 / C8): UI → /editor?component=<iri>, AI → /ai-editor?component=<iri>.
export function componentEditLink(entry) {
  const kind = componentKind(entry?.doc);
  if (!kind || !entry.iri) return null;
  const q = `?component=${encodeURIComponent(entry.iri)}`;
  return kind === 'ai'
    ? { route: 'ai-editor', resource: `/ai-editor${q}` }
    : { route: 'ui-editor', resource: `/editor${q}` };
}

// ---------------------------------------------------------------------------
// v0.7 §1.4.4 — three-level storage (workstream 3 rev 9, F1.1/F1.2):
//   (0) draft = localStorage (never listed here) — (1) local-saved =
//   /users/<pk>/components/ on the participant's pod (badge `local`) —
//   (2) published = app store /components/ + POST /features/ (badge `published`).

// Private components container path of the current participant, from the webid
// (https://<pod>/users/<pk>) or from the prefs IRI (/prefs/<pk>).
export function localComponentsPath(webidOrPrefsIri, podUrl) {
  if (!webidOrPrefsIri) return null;
  const s = String(webidOrPrefsIri);
  const pk = s.match(/\/users\/(\d+)/)?.[1] ?? s.match(/\/prefs\/(\d+)/)?.[1];
  return pk ? `/users/${pk}/components/` : null;
}

// Level badge of an entry: explicit `level`, else derived from the IRI.
export function entryLevel(entry) {
  if (entry?.level) return entry.level;
  return typeof entry?.iri === 'string' && /\/users\/\d+\/components\//.test(entry.iri) ? 'local' : 'published';
}

// Aggregate the two levels into rows: one row per slug, `levels` = ['local'] /
// ['published'] / both. Published IRI wins for the edit link (it is the canonical one).
export function mergeLevels(localEntries = [], publishedEntries = []) {
  const bySlug = new Map();
  for (const e of localEntries) {
    if (!e?.slug) continue;
    bySlug.set(e.slug, { ...e, levels: ['local'] });
  }
  for (const e of publishedEntries) {
    if (!e?.slug) continue;
    const prev = bySlug.get(e.slug);
    bySlug.set(e.slug, prev ? { ...e, iri: e.iri ?? prev.iri, levels: [...new Set([...prev.levels, 'published'])] } : { ...e, levels: ['published'] });
  }
  return [...bySlug.values()];
}

// sha384 (base64) of the canonical JSON, @id excluded — same hash as the J8/F6 integrity hash.
export function canonicalJsonLite(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJsonLite).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJsonLite(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
export function hashableDocLite(doc) {
  const { '@id': _omit, ...rest } = doc ?? {};
  return rest;
}
export async function sha384B64(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('WebCrypto subtle unavailable');
  const buf = await subtle.digest('SHA-384', new TextEncoder().encode(text));
  // same base64 as app-ui-editor publish.js (btoa over the raw bytes)
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// F1.2 — before transferring local → store, re-verify the sha384 integrity hash.
export async function verifyIntegrity(entry, subtle) {
  if (!entry?.sri || !entry?.doc) return false;
  const h = await sha384B64(canonicalJsonLite(hashableDocLite(entry.doc)), subtle);
  const stored = String(entry.sri).replace(/^sha384-/, ''); // accept both SRI-prefixed and raw base64
  return h === stored;
}

// Catalogue line (POST /features/, admin) for a declarative-stage component —
// mirrors app-ui-editor preparePublication (J8, spec app-store v0.5 §1.4.3).
export function catalogueLineFor(entry, { route, roleMin = 'admin', category = 'tools' } = {}) {
  const doc = entry.doc ?? {};
  const slug = entry.slug;
  const documentIri = entry.iri ?? `/components/${slug}`;
  return {
    slug,
    route: route ?? `/c/${slug}`,
    stage: 'declarative',
    document_iri: documentIri,
    sri: entry.sri,
    title_i18n: doc['cmp:label'] ?? { en: slug },
    description_i18n: { en: `${String(doc['@type'] ?? '').replace('cmp:', '')} on ${doc['cmp:source'] ?? ''}` },
    role_min: roleMin,
    category,
    menu_order: 100,
    default_enabled: false,
    in_menu: false,
    component: 'cmp-runtime',
  };
}
