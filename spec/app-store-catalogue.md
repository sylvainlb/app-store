# Feature catalogue — App store (energy supervision app)

Spec dedicated to the **content** of the `app.features` catalogue of the supervision app: full seed (5
base features) + proposed business features, each with its role, route, component, data access
contract and server change requests. Separate from `app-store-spec.md` (the mechanism) so as not to
disrupt work on the component.

- **Version**: 0.5 — v2 (21/11): the 12 features of batches 1–3 are seeded as **remote**
  features (v2 columns filled: `npm_package=@facis/app-features`, `version`,
  `cdn_url`, `sri` real sha384 of the bundle, `tag`) by the **generated** SQL
  `app-store/sql/130_features_catalogue_v2.sql` (build: `app-features/scripts/build.mjs` →
  `dist/<slug>.js` + `dist/manifest.json`; bundles served in dev same-origin via
  `app-supervision/public/features-dist/`, prod = jsDelivr). Routes declared in
  `orbit.json` with `menu:false, components:[]` → mounted on the fly via `<dynamic-feature>`.
  CI check: `app-store/tck/v2-catalogue.test.js` (catalogue ↔ seed ↔ manifest ↔ orbit.json).
  And §3 below remains the business reference (batches, data access, CRs).
- **Version**: 0.5 — **LDP-only decision**: no more `POST /app/query` proxy (workstream O-1 dropped), all gold matviews published as LDP containers, from/to windowing client-side. Aligned with `app-store-spec.md` v0.4, the app's real `orbit.json`
  (`app-supervision/orbit.json`), and the real silver/gold names of the FAP-light server
  (`silver.energy_price`, `silver.city_event`, gold `weather_hourly` in `datasets.json`)
- **Version**: 0.6 — **declarative stage (J8 ratified, workstream 3)**: this file seeds only the **code** stage (`stage='code'`, column default). Declarative components are NOT seeded: they are published at runtime via `POST /features/` (admin) from the workstream 3 editor (`app-ui-editor/`), their versioned document living in the `/components/` container. Typical line: `stage='declarative'`, `document_iri`, `sri` = sha384 of the canonical document content (`@id` excluded), `component='cmp-runtime'`, dedicated `route`, `role_min`, `category` (store section crossed with `stage`). See `app-store-spec.md` v0.5 §1.4.3 and `spec/app-ui-component-editor` rev 5.
- **References**: `app-store-spec.md` v0.4, `supervision-energetique-front-technique.md` (§13),
  `supervision-energetique-spec-fonctionnelle.md`, `model-injection-spec.md`, `fap-ldp-spec.md` v0.4
- **Seed rule**: each entry = one `app.features` row (in v1, the columns
  `npm_package`/`sri`/`tag` are **absent** — added by `sql/020_features_v2.sql` in v2) +
  default prefs `enabled=false` (except the 5 base features). Seed delivered as **initdb SQL**
  (pattern `101_seed_demo.sql` of the app), CI check seed ↔ `orbit.json` (app-store-spec §1.9.8).

---

## 1. Base seed — app features, **aligned with the real `orbit.json`** (menu_order 0–9, default_enabled=true)

`app-supervision/orbit.json` declares the routes with their roles: `dashboard /` (manager),
`anomalies /anomalies`, `tickets /tickets`, `building-detail /buildings/:id` (manager),
`interventions /interventions` (technician), `admin /admin` (admin), `store /store` (all).
The `ticket-new` / `ticket-detail` routes are **sub-routes** of tickets/interventions, not menu
features. The seed below matches orbit.json (otherwise the CI check §1.9.8 and the guard
diverge); `config_schema` = `{"fields": []}` (shape expected by solid-form, not `'{}'`).

```sql
INSERT INTO app.features (slug, title_i18n, description_i18n, icon, menu_order, role_min,
                           component, route, config_schema, default_enabled) VALUES
('dashboard',       '{"fr": "Tableau de bord"}',
                   '{"fr": "Carte du parc et synthèse énergie."}', 'map', 0, 'gestionnaire',
                   'building-map', '/', '{"fields": []}', true),
('anomalies',       '{"fr": "Anomalies"}',
                   '{"fr": "Anomalies détectées par la FAP."}', 'warning', 1, 'gestionnaire',
                   'anomaly-list', '/anomalies', '{"fields": []}', true),
('tickets',         '{"fr": "Tickets"}',
                   '{"fr": "Interventions et leur suivi (gestionnaire)."}', 'confirmation_number', 2, 'gestionnaire',
                   'ticket-board', '/tickets', '{"fields": []}', true),
('interventions',   '{"fr": "Mes interventions"}',
                   '{"fr": "Tickets assignés (technicien)."}', 'assignment', 3, 'technicien',
                   'ticket-board', '/interventions', '{"fields": []}', true),
('building-detail', '{"fr": "Détail bâtiment"}',
                   '{"fr": "Courbes de conso/PV d’un bâtiment."}', 'insights', 4, 'gestionnaire',
                   'energy-chart', '/buildings/:id', '{"fields": []}', true),
('store',           '{"fr": "App store"}',
                   '{"fr": "Activer / configurer les fonctionnalités."}', 'storefront', 8, 'all',
                   'app-store', '/store', '{"fields": []}', true),
('admin',           '{"fr": "Administration"}',
                   '{"fr": "Utilisateurs, rôles, catalogue."}', 'admin_panel_settings', 9, 'admin',
                   'user-admin', '/admin', '{"fields": []}', true)
ON CONFLICT (slug) DO NOTHING;
```

## 2. Data access contract per feature — **LDP only**

Decision (v0.5): **no heavy query in the use cases** → no more `POST /app/query` proxy
(workstream O-1 dropped). All reads go through **published LDP containers** (`GET` via
`fetchAuthn`, OIDC session + ACL/RLS on the FAP-LDP side); the `from`/`to` windowing is done
**client-side**. The `POST /dsp/data` data plane (HMAC) remains reserved for external
server-to-server consumers (front spec §13.1).

**via** legend: `LDP` = published container (direct read sibStore / getJson).

**Server change requests (CR)**:
- CR-0: publish **all** gold matviews as LDP containers (extend
  `app-supervision-backend/sql/104_gold_ldp_published.sql`: `net_grid_hourly`,
  `pv_performance_hourly`, `weather_hourly`, + CR-1/CR-4 below). Rule §13.3
  (decision G) is revised: with no heavy query, the hourly volume is
  also served over LDP.
- CR-1: gold matviews `price_hourly` and `city_event_hourly` from the real silver views
  **`silver.energy_price`** and **`silver.city_event`**, published as **LDP containers**
  `/gold/price_hourly/`, `/gold/city_event_hourly/`.
- CR-2: DDL `area_m2` (number, nullable) + `lat`/`lon` (double, WGS84) on `app.buildings` in
  `fap-ldp/examples/supervision/004_app.sql` and `model.json` (lat/lon already in front change request
  §13.4).
- CR-3: LDP exposure of versions: sub-container `/tickets/<pk>/versions/`. **Scope: FAP-LDP
  core** (PEP + mapping `app.versions` → container), not only the `app.*` SQL.
- CR-4: gold matview `annual_site_consumption` (kWh/yr per building), published as LDP container
  `/gold/annual_site_consumption/` (regulatory export).
- CR-5: LLM endpoint `POST /app/llm` (a function, not a data resource: the data is read over
  LDP with ACL/RLS) — **this CR creates the flow**, see §4.6.

## 3. Proposed extended catalogue (batches)

Columns: `role_min` · route · component · via · possible server CR.

### Batch 1 — immediate value, little server impact
| slug | order | role | route | component | via | config_schema (fields) | CR |
|---|---|---|---|---|---|---|---|
| `alert-rules` | 10 | manager | `/alerts` | `alert-list` | LDP `/gold/anomaly_candidates/` + `/buildings/` + prefs | `thresholds`: object (building→{kW, eur_day}) | — (client-side evaluation, UI badge) |
| `sla-dashboard` | 11 | manager | `/sla` | `sla-view` | LDP `/tickets/` + `/tickets/<pk>/versions/` | `sla_hours`: number (default 24) | CR-3 |
| `report-builder` | 12 | manager | `/reports` | `report-form` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | `period`: enum [day,week,month,year], `building`: string, `format`: enum [pdf,csv] | — |

### Batch 2
| slug | order | role | route | component | via | config_schema | CR |
|---|---|---|---|---|---|---|---|
| `budget-tracker` | 20 | manager | `/budget` | `budget-gauge` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | `budget_kwh`: number (req), `budget_eur`: number, `alert_pct`: number (default 80) | — (client-side calculation) |
| `price-optimizer` | 21 | manager | `/optimize` | `shift-advisor` | LDP `/gold/price_hourly/` + `/gold/net_grid_hourly/` | `shiftable_kwh`: number, `window`: string (format `HH:MM-HH:MM`) | CR-1 + CR-0 |
| `pv-selfconsumption` | 22 | manager | `/pv` | `pv-gauge` | LDP `/gold/pv_performance_hourly/` + `/gold/net_grid_hourly/` | `battery_kwh`: number (default 0) | CR-0 |
| `benchmark` | 23 | manager | `/benchmark` | `benchmark-view` | LDP `/gold/annual_site_consumption/` + `/buildings/` | `metric`: enum [kwh_m2, eur_m2], `period`: enum [month,year], `ref_building`: string | CR-2 + CR-0/CR-4 |
| `regulatory-export` | 24 | manager | `/regulatory` | `regulatory-export` | LDP `/gold/annual_site_consumption/` | `year`: number, `format`: enum [csv,json] | CR-4 + CR-0 |

### Batch 3
| slug | order | role | route | component | via | config_schema | CR |
|---|---|---|---|---|---|---|---|
| `weather-correlation` | 30 | manager | `/weather` | `weather-chart` | LDP `/gold/weather_hourly/` | `station`: string, `period`: enum [7d,30d,90d] | CR-0 |
| `city-events` | 31 | manager | `/city` | `city-feed` | LDP `/gold/city_event_hourly/` | `zone`: string, `radius_km`: number | CR-1 + CR-0 |
| `ai-assistant` | 32 | manager | `/assistant` | `ai-chat` | LDP (data, ACL/RLS) + ORCE LLM endpoint | `assets`: array (items string), `model`: string | CR-5 (LLM endpoint, see §4.6) |
| `data-sharing` | 33 | admin | `/sharing` | `share-manager` | DSP control plane (core, exists) | `asset`: string, `consumer_did`: string, `duration_days`: number | — |

## 4. Settled business decisions (open points completed)

1. **alert-rules**: **client-side** evaluation (confirmed) on the already-fetched data; v1
   notification channel = **UI badge only** (no email, no push). `window` field format
   validated: `HH:MM-HH:MM` (regex `^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$`).
2. **sla-dashboard**: SLA = delay **creation (`tickets.created_at`) → status `RESOLVED`** (read in
   `app.versions`, CR-3); `sla_hours=24` is the default global threshold, overridable per priority
   via an optional `thresholds`-like object. A ticket RESOLVED beyond the threshold = "SLA breached".
3. **report-builder**: v1 = **client-side PDF/CSV** generation (jsPDF) from the already-fetched
   data, direct download. The `recipients` (email) field is **removed from the v1 config_schema**
   — no mail channel exists; sending by mail = v2 (ORCE flow + SMTP).
4. **regulatory-export**: v1 = **annual CSV per site** (kWh/yr), computed **server-side**
   (matview `annual_site_consumption`, CR-4), not client-side. The exact OPERAT format remains to
   be confirmed with the business (open point); the v1 CSV is the common subset.
5. **benchmark**: `area_m2` **manual entry** in the building form (v1); cadastral import = v2.
6. **ai-assistant**: **no LLM flow exists today on the FAP-light side**
   (`app-supervision-backend/flows/app-supervision.json` does not contain one; AI Insight is a direct
   Postgres consumer, decisions D-5/D-6, outside the server scope). It is **CR-5** that creates
   the endpoint `POST /app/llm` (LLM function — the data itself is read over **LDP** with
   ACL/RLS). Endpoint contract: OIDC session auth, rate limit 10 req/min/user, audit
   `dsp.audit`. **Bounded scope**: only the assets listed in `config.assets` are
   readable — never the whole gold without ACL.
7. **data-sharing**: the **contract lookup exists** on the core side (DSP state in PostgreSQL + TTL
   capability token, summary §4.1), but the self-service path "offer → negotiation → agreement"
   **is not demonstrated** on the core side — to be confirmed before dev. v1: `share-manager` wraps the
   existing core endpoints (catalogue + lookup), no new server; the admin F6 UI is its basis.

## 5. Quality / tests

- **CA-A8 (TCK)**: for **each seeded feature**, effective data access test (not just the
  menu): unauthorized role → 403/404 on the feature's data source (ACL/RLS); authorized role →
  200. The role × feature matrix is generated from the seed.
- **i18n**: the `label`s of `config_schema` are **not localized in v1** (FR-only front, M4) —
  plan `label_i18n` in v2 to avoid a schema migration.
- **CI**: check seed ↔ `orbit.json` (non-blocking warning as long as the component is not packaged,
  app-store-spec §1.9.8); seed delivered **by batch** (batch 1 first).

## 6. Remaining open points

- Exact OPERAT format (business); cadastral import for `area_m2` (v2); mail channel for reports
  (v2); sandbox of the LLM component (v2, see app-store-spec Part 2).
