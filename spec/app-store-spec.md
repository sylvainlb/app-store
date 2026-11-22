# Specification — App store (catalogue of toggleable features)

Reusable component allowing a FAP/Startin'blox application to offer a **catalogue of
features** that the user enables or not, with **per-feature configuration**, and a
**menu generated dynamically** from the user configuration.

- **Version**: 0.4 — document in **two parts**: Part 1 = v1 (to implement, details
  settled in §1.9), Part 2 = v2 (specified, not a priority)
- **Separate project: yes** — independent repository/package, installable in any FAP/SIB app
- **References**:
  - `supervision-energetique-front-technique.md` (§7 components, §13 decisions)
  - `fap-ldp-spec.md` v0.4 (LDP endpoint, `app.*`, RLS/ACL, PEP, generic triggers §5.1/5.2)
  - `../architecture-djangoldp/1_SIB_ARCHITECTURE.md` (sibStore, Orbit, sib-router, boilerplate, CDN/SRI)
  - `app-store-catalogue.md` (suggested content of the `app.features` catalogue — separate spec)

---

# Part 1 — v1: packaged features, dynamic menu

## 1.1 Objective and scope (v1)

Two blox delivered by the project: `<app-store>` (catalogue list + toggles + configuration
forms) and `<app-menu>` (app menu generated from the preferences). Plus the **declarative
model** (catalogue + preferences): `model.json` fragment applied at boot by the FAP-LDP
node (fap-ldp-spec §5), the catalogue seed remaining in the app's initdb SQL (§1.3).

In v1, only features **already packaged** in the app (declared in `orbit.json`) are
offered: the app store enables/disables and configures them; the menu and route guards are
dynamic. Loading remote components is Part 2 (v2).

## 1.2 Principles

1. **Everything is an LDP resource**: catalogue and preferences live in `app.*`, served by
   the FAP-LDP endpoint, read/written via sibStore. **Nothing is persisted in localStorage in v1**
   (the sibStore cache is in-memory only).
2. **The menu is UX, not security**: hiding an entry disables nothing server-side —
   any feature with a server-side effect stays guarded by ACL/PDP (e.g. data space publication).
3. **Per-user, synchronized preferences**: one resource per user, RLS `webid` — readable/
   modifiable only by its owner (and `admin`).

## 1.3 Separate project — suggested layout

```
app-store/                         ← independent repository (e.g. facis/app-store)
├── components/                    ← web components package (SIB boilerplate)
│   ├── app-store/                 ← <app-store>: catalogue list + toggles + config
│   └── app-menu/                  ← <app-menu>: dynamic menu from the prefs
│   └── shared/                    ← delivered helpers: window.appStore.isEnabled(slug),
│                                  ←   mePrefsIri(), AppStoreGuardMixin (§1.9.7)
├── model/
│   └── app-store.model.json       ← SOURCE OF TRUTH of the model: model.json fragment (tables,
│                                  ←   fields, RLS, ACL, asset_mapping, referenced triggers),
│                                  ←   integrated into the app's model.json and applied AT BOOT by
│                                  ←   the FAP-LDP node (fap-ldp-spec §5; same DSL as E11, annex A)
├── sql/
│   ├── triggers/                  ← plpgsql bodies of the 2 triggers referenced by the JSON
│   │   ├── app_store_on_user_insert.sql
│   │   └── app_store_on_feature_insert.sql
│   ├── 010_features.sql           ← REFERENCE DDL generated from the JSON (debug/drift — do NOT
│   │                              ←   apply by hand; edit the JSON)
│   ├── 011_prefs.sql              ← same (app.prefs + RLS/ACL + CREATE TRIGGER)
│   ├── 012_backfill_prefs.sql     ← ONE-SHOT migration: backfill prefs/ACL of existing users
│   │                              ←   at deployment (role admin, idempotent)
│   ├── 020_features_v2.sql        ← Part 2: v2 columns (npm/sri…) + model_injected
│                                  ←   (L3: NOT in v1, Part 1 unchanged)
│   └── README.md                  ← installation procedure
├── spec/                          ← this spec (source: atlas/spec/app-store-spec.md)
└── tck/                           ← Cypress component tests + LDP e2e
```

Installation in an app (v1): integrate `model/app-store.model.json` into the app's
`model.json` (applied at boot by the node, after `core/sql/00*.sql`), run **once**
`sql/012_backfill_prefs.sql` (role `admin`), mount `<app-store>` / `<app-menu>` in the Orbit
shell, declare the features in `orbit.json`. **The package delivers the model structure in JSON +
the triggers + the migration; the catalogue seed is provided by the app via an initdb SQL
file** (pattern `101_seed_demo.sql`, channel settled with `model-injection-spec.md` §1.4 — no
`seed` key in `model.json`), with a CI check seed ↔ `orbit.json` (§1.9.8). Suggested content:
`app-store-catalogue.md`.

**Static vs injected boundary (L2)**: the app-store mechanism itself (`app.features`,
`app.prefs`, `model/app-store.model.json`) is **static** — deployed with the server, identical
for all apps. What is **hot-injected** is the model of *third-party features*: via
E11 (`model-injection-spec.md`, contract `POST /admin/apps`, model fragments, `app.app_packages`,
containers `/apps/<slug>/…`, tables `store_<slug>_*`), used by Part 2 in v2.

## 1.4 Data model v1 (`app.*`)

Cross-cutting fields on **both tables** (they benefit from the generic fap-ldp triggers §5.1/5.2):
`created_at`, `updated_at` (+ trigger), `deleted_at` (tombstone), versioning via `app.versions`.
`published=false` in `dsp.asset_mapping` for `/features/` and `/prefs/` (pod-internal, never exposed
in the data space).

### 1.4.1 Catalogue — `app.features` (managed by `admin`)
| Column | Type | Role |
|---|---|---|
| `id` | bigserial PK | internal key (base triggers: `NEW.id`) |
| `slug` | text UNIQUE NOT NULL | stable identifier (`building-map`, …) — IRI `/features/<slug>` (decision B2) |
| `title_i18n`, `description_i18n` | jsonb | **localized from v1**: `{"en": "…", "fr": "…"}` (decision A2, §1.9.2) |
| `icon` | text | icon name from the allowed set (Material Icons), fallback `extension` (§1.9.3) |
| `menu_order` | int NOT NULL DEFAULT 0 | menu order; sort = `(menu_order, slug)` (§1.9.1) |
| `component` | text | custom element tag (packaged in the app in v1) |
| `route` | text | associated Orbit route |
| `role_min` | text DEFAULT 'all' | minimum role to see/enable the feature (`all` \| `technician` \| `manager` \| `admin`) — menu + guard filtering; security stays server-side ACL/PDP |
| `in_menu` | bool DEFAULT true | `false` = out of the menu (tool, e.g. app-store reached via a header icon); the route stays accessible and guarded |
| `config_schema` | jsonb | meta-schema §1.9.6 |
| `default_enabled` | bool | default state (also used if the key is missing from prefs) |
| `category` | text NULL | **store section** (migration `021_features_category.sql`): `supervision` \\| `operations` \\| `energy` \\| `compliance` \\| `tools` (seeded values; any other value = section named as-is; NULL = « Other »). Organizes `<app-store>` into sections + filters (§1.6.2); **no effect on the menu** (stays flat) nor on security (ACL/PDP). Modifiable by the admin via PATCH `/features/<slug>` |

LDP: container `https://<pod>/features/`, resources `/features/<slug>` — **custom**
`resource_iri_pattern` `/features/<slug>` set in `dsp.asset_mapping` (the PEP maps any named
placeholder onto its column: `pkWhere = <param> = $n`); no PEP change, covered by CA-A7. In v1 no
`POST /features/` (admin = metadata only, §1.9.8): the catalogue is populated by the seed.
Read: all authenticated users of the pod; write: `admin`.
**ACL seed (M2)**: `foaf:Agent` + `inherited=true` in `read` on `/features/` (externals are anyway
stopped at step 1 of the PDP, container `published=false`); `role:admin` in `write` on
`/features/`.

### 1.4.2 Preferences — `app.prefs` (one row per user)
| Column | Type | Role |
|---|---|---|
| `id` | bigserial PK | internal key (base triggers) |
| `user_id` | bigint UNIQUE NOT NULL, FK → app.users **ON DELETE CASCADE** (GDPR) | owner — IRI `/prefs/<user_id>` (custom pattern on `user_id`) |
| `prefs` | jsonb NOT NULL DEFAULT '{}' | `{"<slug>": {"enabled": bool, "config": {...}}}` |

LDP: **unique** resource per user `https://<pod>/prefs/<user_id>` (decision B1/B3:
flattened resource with a jsonb column, atomic PATCH — and not `/users/<pk>/prefs`).
PUT/PATCH merge-patch to modify. RLS: `auth.can` on the IRI → a user sees/modifies
**only** their own prefs; for another user the PDP returns **403** before the RLS (revised decision
§1.9.10: 403 uniform with the non-existent — does not leak existence). Trigger on user creation: default prefs from
`app.features.default_enabled` **and** owner-webid ACL (read/write/control) on `/prefs/<pk>` +
`role:admin` (M2); backfill of existing users at deployment via `012_backfill_prefs.sql`
(prefs + ACL, §1.9.4). When the admin adds a feature: trigger on INSERT `app.features` that
injects the default key into all existing prefs.

## 1.5 Exposed LDP contract (v1)

- `GET /features/` → catalogue (container, `ldp:contains` = slugs); `GET /features/<slug>` → record.
- `GET /prefs/<user_pk>` → prefs of the logged-in user (another user → **403**, uniform with the non-existent).
- `PATCH /prefs/<user_pk>` (merge-patch) — body conforming to the column→property mapping, the jsonb
  is **not** flattened at the root (form R1): `{"prefs": {"building-map": {"enabled": false}}}`.
  **Semantics observed on the live server (21/11): the PEP replaces the whole jsonb `prefs`
  column** (no deep server-side merge) — the client therefore does a **read-modify-write**:
  it merges the patch with its current state (merge by slug, to preserve `config` when only
  touching `enabled`) and sends the **complete** `prefs` object, protected by `If-Match` → `412`
  on conflict (§1.9.9). The column is read in GET under the serialized key of the mapping
  (`prefs`, `prefs:prefs`, `app_prefs:prefs`… — generic client-side parsing).
- `dspace:Error` errors; ETag/If-Match like the rest of the endpoint; `412` → reload the prefs +
  toast "changed in the meantime" (§1.9.9).

## 1.6 Components and behavior (v1)

### 1.6.1 `<app-menu>` (in the shell)
- Reads `window.appStore.mePrefsIri()` (= `/prefs/<pk>` extracted from the webid claim) via
  `window.sibStore.getData()`; subscribes to the store PubSub on this IRI and to the `save` event.
- Renders one `solid-link` per feature `enabled=true` **and** `role_min` compatible with the current
  role (exact match, like the `roles` of orbit.json routes; `admin` sees everything), sorted by
  `(menu_order, slug)`, joined with the catalogue (unknown prefs slugs are ignored, §1.9.4).
- Route guard: listens to the `navigate` event in the shell + helper `window.appStore
  .isEnabled(slug)` → disabled or unknown feature → redirect `/` (§1.9.7).

### 1.6.2 `<app-store>` (route `/store`, any authenticated user; admin edits the metadata)
- **Organization by use case (decision 21/11)**: the store is **not** a flat list —
  toolbar (a **search** field on slug/title/description + **category chips** with
  counters) then **sections per category** (`category`, fixed order `supervision, operations, energy,
  compliance, tools`, unknown ones alphabetically, no category last « Other »).
  Search and chip are combinable (intersection); empty state « No feature matches. ».
  The **`<app-menu>` menu stays flat** — categorization only lives in `/store`.
- **List**: `ComponentObjectsHandler` on `/features/` + current prefs → toggle (switch) per
  feature; "configured" badge (definition §1.9.11); "Configure" button **only if the
  feature is enabled AND `config_schema.fields` is non-empty** (otherwise nothing to configure / not
  active → button hidden, never shown disabled).
- **Toggle**: PATCH merge-patch on `/prefs/<user_pk>` with body form R1 §1.5
  `{"prefs": {…complete merged object…}}` (read-modify-write + If-Match, semantics §1.5) then
  manual dispatch of the `save` event (contract §1.9.9) → `<app-menu>` and the current route
  update live.
- **Config form**: **modal in `/store`** (§1.9.11), `solid-form` driven by
  `config_schema`, writing the `config` sub-key of the prefs.
- **Admin (v1)**: edits the **metadata only** of already-packaged features
  (decision A8, §1.9.8): title/description/icon/category/menu_order/config_schema/default_enabled.

### 1.6.3 Orbit integration (v1)
All features are **declared at build time** in `orbit.json` (routes + components, pinned npm,
SRI at build). The app store only shows/hides/configures them — no dynamic component
registration in v1.

## 1.7 Security (v1)

- Prefs: RLS/ACL owner-only (§1.4.2). Catalogue: internal read, `admin` write.
- Menu = UX only; never an authorization barrier (§1.2.2).

## 1.8 Acceptance criteria (v1)

- CA-A1: `<app-menu>` shows exactly the `enabled=true` features of the logged-in user's prefs,
  sorted by `(menu_order, slug)`; a prefs PATCH updates the menu without reload.
- CA-A2: toggle in `<app-store>` → PATCH merge-patch on `/prefs/<user_pk>` with body
  `{"prefs": {…}}` form R1 (complete object, read-modify-write §1.5) → version created, immediate read-after-write,
  other features' config preserved; another user GET-ing my prefs → **403** (uniform
  with a non-existent resource — does not leak existence).
- CA-A3: config form of a feature writes `config` conforming to `config_schema`
  (front-end validation in v1, §1.9.6).
- CA-A4: route of a disabled feature → redirect `/` (shell guard + mixin).
- CA-A7: `GET`/`PATCH`/`DELETE /features/<slug>` resolved via the custom pattern `/features/<slug>`
  (`slug` column, not the PK) — proven by a TCK test.

## 1.9 Settled details (reviewed before component dev)

1. **Menu order**: `menu_order int NOT NULL DEFAULT 0` on `app.features`; menu sort =
   `(menu_order ASC, slug ASC)`.
2. **Catalogue i18n (A2)**: `title_i18n`/`description_i18n` in **localized jsonb from v1**
   (`{"en": "…", "fr": "…"}`) — the package is generic; the default UI is EN and reads
   `…_i18n[locale]` with fallback `en` then `fr` then `slug`. No schema migration in v2.
3. **Icons**: allowed set = **Material Icons** names; fallback `extension` if the name is unknown.
4. **Features added/removed after the fact**: (a) front rule "key absent from prefs =
   `default_enabled`"; (b) trigger on INSERT `app.features` that injects the default key into
   all existing prefs; (c) `012_backfill_prefs.sql` for users existing at deployment; (d) when a
   feature is removed, the menu **joins with the catalogue and ignores unknown slugs** from the
   prefs, and a maintenance job removes ghost keys from the prefs jsonb.
5. **Cross-cutting fields**: `created_at`/`updated_at` + trigger, versioning (`app.versions`),
   tombstone (`deleted_at`) on `app.features` and `app.prefs`; index on `features.slug` (unique);
   `ON DELETE CASCADE` prefs→users; `published=false` in `dsp.asset_mapping` for `/features/`
   and `/prefs/`.
6. **`config` validation against `config_schema` (A6)**: **front-end only in v1** (solid-form);
   PEP validation (409 `dspace:Error`, like decision K on transitions) planned **in v2
   (post-v1)** (M3: no "v2.1" in the phasing). Exact meta-schema of `config_schema` (N1:
   extended to `object` and `array` to cover the catalogue):
   `{"fields": [{"key": string, "label": string,
   "type": "string"|"number"|"boolean"|"enum"|"object"|"array",
   "default"?: any, "options"?: string[] (if enum), "items"?: "string" (if array),
   "required"?: bool}]}` — `object` = free jsonb, `array` = array of string.
   Note (M4): the `label`s are **not localized** in v1 (default EN front) — to localize in v2
   (`label_i18n`) to avoid a schema migration.
7. **Route guard**: sib-router/Orbit has no native guard → implementation: the shell listens
   to `navigate` and redirects `/` if `!window.appStore.isEnabled(slug)`; the package delivers the helper
   `window.appStore.isEnabled(slug)` (reads the prefs from the cache) and an `AppStoreGuardMixin` for
   route components, so nothing is re-implemented per business component.
8. **Catalogue ↔ orbit.json consistency (A8)**: in v1, the admin edits **only the metadata** of
   features already declared in `orbit.json` (adding a feature = repackage the app). The menu
   only shows features whose route exists (`window.orbit.getRoute`), and a build-time CI check
   warns if the catalogue seed references an unknown component/route.
9. **`save` event contract**: `sibStore.patch()` does not emit `save` by itself — after the
   prefs PATCH, `<app-store>` does
   `document.dispatchEvent(new CustomEvent("save", {detail: {resource: {"@id": prefsIri}}}))`;
   `<app-menu>` refreshes via its PubSub subscription on this IRI. `412` → reload the prefs +
   toast "changed in the meantime".
10. **403 vs 404 for another user's prefs**: revised decision after a real test — the PEP returns
    **403** (the PDP blocks on the ACL before the RLS; a non-existent resource under a known container
    also returns 403, so the response is uniform and does not leak existence). Written in the TCK (CA-A2).
11. **Config form UX**: "Configure" opens a **modal in `/store`** (no dedicated route
    in v1). "configured" badge = `config` non-empty **and** different from the `default`s of
    the `config_schema` (JSON comparison).
12. **`<me>`**: the pk is extracted from the `webid` claim (`https://<pod>/users/<pk>` → `/prefs/<pk>`) via
    the helper `window.appStore.mePrefsIri()`; a webid outside the pod is **forbidden in v1** (403).

---

# Part 2 — v2: hot-loading of remote components (specified, not a priority)

Everything below **adds to** Part 1 without modifying it (the v2 columns live in
`sql/020_features_v2.sql`, applied only in v2).

## 2.1 What v2 adds to the data model

- `app.features` + columns: `npm_package`, `version` (exact, no `^`), `cdn_url` (jsDelivr),
  `sri` (SHA-384), `tag` (remote custom element).
- `app.prefs.prefs`: each feature entry can carry `installed_version`, `installed_sri`
  (actually-loaded version).

## 2.2 What v2 implies technically

1. **Dynamic loader**: on activation of a remote feature, the shell imports the ES module:
   `await import(cdn_url)` then mounts `<tag>` in a `<dynamic-feature>` host.
2. **SRI and dynamic import — the hard point**: the `integrity` attribute only applies to
   `<script>` tags, **not** to `import()`. It must therefore be verified manually: `fetch(cdn_url)` →
   `crypto.subtle.digest('SHA-384', buf)` → comparison with the catalogue's `sri` → import via
   `URL.createObjectURL(new Blob([src], {type:'text/javascript'}))`. Simpler alternative:
   CDN origin whitelist + pinned version, without hash verification. **v2 decision retained:
   fetch + manual SHA-384 verification before import** (otherwise a compromised CDN = signed XSS).
3. **Confirmation and audit**: modal **in `/store`** (no raw `window.confirm`):
   feature title/description, `package@version`, **shortened** SHA-384 fingerprint (complete
   on hover) and trust notice "the component runs with your rights" (§2.2.6); Install button
   disabled if the sri is absent. The install is recorded in the prefs
   (`installed_version`, `installed_sri`) and audited server-side (`dsp.audit` / ORCE log:
   webid, slug, version, ts).
4. **Revocation**: from the app store, "uninstall" → prefs updated, module removed from the
   cache, element unregistered. Packaged features (v1) are not "uninstallable".
5. **Cache**: Cache API / service worker for offline; **upgrade**: if the catalogue announces
   a version > `installed_version` → update prompt (re-verification of the new sri).
6. **Trust model**: a loaded component has access to the user's `fetchAuthn` — hence to
   everything the user can read/write. The trust decision is made **at install time**
   (explicit UI). Post-v1 option: iframe sandbox + restricted postMessage bridge
   (the remote component does not touch fetchAuthn directly).
7. **Menu**: `<app-menu>` unchanged (it reads the prefs); the route of a remote feature is mounted
   on the fly via `<dynamic-feature>`.

## 2.3 What v2 does not change

The server-side PDP/ACL/RLS: a remote component runs with the user's credentials, nothing
more. Features with a server-side effect stay guarded by the server whatever the menu shows.

## 2.4 Security (v2)

- In addition to v1 security (§1.7): pinned version + sri verified before each import;
  user confirmation; audit; revocation.

## 2.5 Acceptance criteria (v2)

- CA-A5 (v2): activating a remote feature without a valid sri → refused; with a valid sri →
  verified import, component mounted, menu updated; revocation → component removed.
- CA-A6 (v2): v2 catalogue (version > installed) → upgrade prompt with hash re-verification.

## 2.6 Phasing and open points (v2)

- **v1 to deliver first** (Part 1): `model/app-store.model.json` + `sql/012_backfill_prefs.sql`,
  `<app-store>` + `<app-menu>`, Orbit integration in the supervision app (base features, seed slugs
  aligned with `orbit.json`: `dashboard`, `anomalies`, `tickets`, `interventions`,
  `building-detail`, `store`, `admin` — see `app-store-catalogue.md` §1).
- **Back-end link (L4)**: a remote feature that needs **tables** does not create them itself
  from the front — it goes through **E11** (`model-injection-spec.md`: `POST /admin/apps`, model
  fragment, containers `/apps/<slug>/…`, tables `store_<slug>_*`; hot injection in v2 via E12).
  Part 2 only describes loading the binary (npm/CDN + SRI); the model is E11's business.

## 2.7 v2 — settled decisions and status (21/11)

- **O-A1 settled: fetch + manual SHA-384 verification before `import()`** (retained decision §2.2.2),
  implemented in `components/shared/loader.js` (`loadRemoteModule`: fetch → `crypto.subtle.digest`
  → base64 compared in constant time → import via blob URL). **The cache does not skip the sri**:
  a cache hit with an sri different from the catalogue's → `SriMismatchError` (otherwise an upgraded
  catalogue not re-verified would be served from the cache). Refused if sri absent (`MissingSriError`).
- **O-A2 settled for v2: trust at install time** (explicit UI "install <pkg>@<version>?"
  showing the sri, §2.2.3); the iframe sandbox + postMessage bridge remains **post-v2**.
- **E11 wired in the deployment**: flow fragment
  `fap-ldp/ext/model-injection/compose/flows/model-injection.json` (nodes `fap-ldp-mi-boot` +
  `fap-ldp-mi-admin`, DSN `${PG_ADMIN_DSN}`), assembled by `assemble-flows.sh`, package mounted in
  ORCE (`/data/node_modules/node-red-contrib-fap-ldp-model-injection`). The core already reserves
  `/admin/*`, `/apps/`, `/apps/<slug>/meta` for the ext. Verified live: `POST /admin/apps` → 201,
  container `/apps/<slug>/<table>/` served by the PEP (mapping cache 60 s), upsert `app.features`
  with `model_injected=true`, 409 on re-POST, 422 `invalid_identifier`.
- **Front v2 delivered**: `components/shared/loader.js` (SRI + import + cache/evict),
  `components/shared/install.js` (orchestrated install/uninstall/upgrade, `installPatch`/
  `uninstallPatch` with `installed_version`/`installed_sri` in the prefs §2.1),
  `components/dynamic-feature/dynamic-feature.js` (on-the-fly mount of a remote feature,
  §2.2.7 — the shell mounts `<dynamic-feature slug>` for a route whose component is not
  packaged), UI in `<app-store>` (badges "remote" / "vX" / "update available", button
  "Update" CA-A6).
- **Color-typed badges** (decision 21/11): `configured` (teal) if `config` non-empty;
  `installed vX` (green) if the remote feature has `installed_version`+`installed_sri` in the
  prefs; `remote · not installed` (indigo) **only if the remote feature is disabled
  and not installed** — an enabled feature is loaded on navigation (bundle + SRI verified +
  `installPatch` recorded), so showing "not installed" on an active feature would
  be misleading (features with `default_enabled=true` never have this badge); `update available`
  (amber) if catalogue version > `installed_version` (CA-A6). Icons in **inline SVG**
  (`components/shared/icons.js`): Material Icons ligatures do not pierce the shadow DOM.
  TCK: `tck/v2.test.js` (12 tests) + `tck/v2-e2e.test.js` (live e2e:
  E11 install → v2 catalogue → prefs → real SRI → revocation), run via `npm run test:e2e`.
- **Slug grammar harmonized in v2**: `app.features.slug` now accepts `_` (E11 slugs are
  `^[a-z][a-z0-9_]{1,30}$`) — constraint widened in `020_features_v2.sql`.
- **v2 base applied live**: `020_features_v2.sql` (columns `npm_package`, `version`,
  `cdn_url`, `sri`, `tag`, `model_injected`), copied as custom migration
  `app-supervision-backend/sql/120_app_store_features_v2.sql` (replayed at boot, idempotent).
- **v2 = everything via the CDN** (decision 21/11): no more business component packaged in
  the app. The base features (dashboard, anomalies, tickets, interventions,
  building-detail, admin) are built as bundles by `app-supervision/scripts/build-features.mjs`
  (`npm run build:features` → `public/features-dist/<slug>.js` + sri manifest) and made
  **remote** by seed `131_base_features_v2.sql`. The shell no longer preloads anything:
  `render()` loads the feature bundle (SRI verified before import, CA-A5) then mounts the route
  tags; batches without declared components go through `<dynamic-feature>`.
  Only the app-store mechanism (`<app-store>`/`<app-menu>`, route `/store`) stays packaged —
  it is the bootstrap that allows installing the others. In fixtures mode (VITE_FIXTURES=1),
  business components are loaded in separate chunks on demand.
- **v2 catalogue populated**: the 12 business features of batches 1–3 (`app-store-catalogue.md` §3,
  components of the `app-features/` repository) are seeded as **remote** features by
  `app-store/sql/130_features_catalogue_v2.sql` (generated by `app-features/scripts/build.mjs`:
  ESM bundle per slug → `dist/<slug>.js`, `sri` = real sha384, `dist/manifest.json`).
  `cdn_url` relative same-origin `/features-dist/<slug>.js` in dev (served from
  `app-supervision/public/features-dist/`); prod = jsDelivr of the published package. Migrations
  `120…` + `130…` replayed at boot; verified live: `GET /features/` → 19 features,
  `GET /features/pv-selfconsumption` → `tag`/`sri`/`cdn_url`/`version` exposed, real install e2e
  (fetch bundle → SRI → `<pv-gauge>` registered → prefs
  `installed_sri`) green. Routes of the 12 features in `orbit.json` (`menu:false`,
  `components:[]`, `dynamic:true`) → mounted via `<dynamic-feature>` when enabled.
