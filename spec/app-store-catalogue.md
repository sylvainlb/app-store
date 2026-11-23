# Catalogue de fonctionnalités — App store (app de supervision énergétique)

Spec dédiée au **contenu** du catalogue `app.features` de l'app de supervision : seed complet (5
features de base) + fonctionnalités métier proposées, avec pour chacune le rôle, la route, le
composant, le contrat d'accès aux données et les change requests serveur. Séparée de
`app-store-spec.md` (mécanisme) pour ne pas perturber le travail sur le composant.

- **Version** : 0.5 — v2 (21/11) : les 12 features des lots 1–3 sont seedées comme features
  **distantes** (colonnes v2 renseignées : `npm_package=@facis/app-features`, `version`,
  `cdn_url`, `sri` sha384 réelle du bundle, `tag`) par le SQL **généré**
  `app-store/sql/130_features_catalogue_v2.sql` (build : `app-features/scripts/build.mjs` →
  `dist/<slug>.js` + `dist/manifest.json` ; bundles servis en dev same-origin via
  `app-supervision/public/features-dist/`, prod = jsDelivr). Routes déclarées dans
  `orbit.json` avec `menu:false, components:[]` → montées à la volée via `<dynamic-feature>`.
  Check CI : `app-store/tck/v2-catalogue.test.js` (catalogue ↔ seed ↔ manifest ↔ orbit.json).
  et §3 ci-dessous reste la référence métier (lots, via données, CR).
- **Version** : 0.5 — **décision LDP-only** : plus de proxy `POST /app/query` (chantier O-1 supprimé), toutes les matviews gold publiées en conteneurs LDP, fenêtrage from/to côté client. Aligné sur `app-store-spec.md` v0.4, `orbit.json` réel de l'app
  (`app-supervision/orbit.json`), et les noms réels silver/gold du serveur FAP-light
  (`silver.energy_price`, `silver.city_event`, gold `weather_hourly` dans `datasets.json`)
- **Version** : 0.6 — **étage déclaratif (J8 ratifié, chantier 3)** : ce fichier seed uniquement l'étage **code** (`stage='code'`, défaut de colonne). Les composants déclaratifs ne sont PAS seedés : ils sont publiés à runtime par `POST /features/` (admin) depuis l'éditeur du chantier 3 (`app-ui-editor/`), leur document versionné vivant dans le conteneur `/components/`. Ligne type : `stage='declarative'`, `document_iri`, `sri` = sha384 du contenu canonique du document (`@id` exclu), `component='cmp-runtime'`, `route` dédiée, `role_min`, `category` (section du store croisée avec `stage`). Voir `app-store-spec.md` v0.5 §1.4.3 et `spec/app-ui-component-editor` rev 5.
- **Références** : `app-store-spec.md` v0.4, `supervision-energetique-front-technique.md` (§13),
  `supervision-energetique-spec-fonctionnelle.md`, `model-injection-spec.md`, `fap-ldp-spec.md` v0.4
- **Règle de seed** : chaque entrée = une ligne `app.features` (en v1, les colonnes
  `npm_package`/`sri`/`tag` sont **absentes** — ajoutées par `sql/020_features_v2.sql` en v2) +
  prefs par défaut `enabled=false` (sauf les 5 features de base). Seed livré en **SQL initdb**
  (pattern `101_seed_demo.sql` de l'app), check CI seed ↔ `orbit.json` (app-store-spec §1.9.8).

---

## 1. Seed de base — features de l'app, **alignées sur `orbit.json` réel** (menu_order 0–9, default_enabled=true)

`app-supervision/orbit.json` déclare les routes avec leurs rôles : `dashboard /` (gestionnaire),
`anomalies /anomalies`, `tickets /tickets`, `building-detail /buildings/:id` (gestionnaire),
`interventions /interventions` (technicien), `admin /admin` (admin), `store /store` (all).
Les routes `ticket-new` / `ticket-detail` sont des **sous-routes** de tickets/interventions, pas des
features de menu. Le seed ci-dessous colle à orbit.json (sinon le check CI §1.9.8 et le guard
divergent) ; `config_schema` = `{"fields": []}` (forme attendue par solid-form, pas `'{}'`).

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

## 2. Contrat d'accès aux données par feature — **LDP uniquement**

Décision (v0.5) : **aucune requête volumineuse dans les cas d'usage** → plus de proxy
`POST /app/query` (chantier O-1 supprimé). Toutes les lectures passent par des
**conteneurs LDP publiés** (`GET` via `fetchAuthn`, session OIDC + ACL/RLS côté FAP-LDP) ;
le fenêtrage `from`/`to` est fait **côté client**. Le data plane `POST /dsp/data` (HMAC)
reste réservé aux consommateurs externes serveur-à-serveur (spec front §13.1).

Légende **via** : `LDP` = conteneur publié (lecture directe sibStore / getJson).

**Change requests serveur (CR)** :
- CR-0 : publier **toutes** les matviews gold en conteneurs LDP (étendre
  `app-supervision-backend/sql/104_gold_ldp_published.sql` : `net_grid_hourly`,
  `pv_performance_hourly`, `weather_hourly`, + CR-1/CR-4 ci-dessous). La règle §13.3
  (décision G) est révisée : en l'absence de requête volumineuse, le volume horaire est
  aussi servi en LDP.
- CR-1 : matviews gold `price_hourly` et `city_event_hourly` à partir des vues silver réelles
  **`silver.energy_price`** et **`silver.city_event`**, publiées en **conteneurs LDP**
  `/gold/price_hourly/`, `/gold/city_event_hourly/`.
- CR-2 : DDL `area_m2` (number, nullable) + `lat`/`lon` (double, WGS84) sur `app.buildings` dans
  `fap-ldp/examples/supervision/004_app.sql` et `model.json` (lat/lon déjà en change request
  front §13.4).
- CR-3 : exposition LDP des versions : sous-conteneur `/tickets/<pk>/versions/`. **Portée : cœur
  FAP-LDP** (PEP + mapping `app.versions` → conteneur), pas seulement du SQL `app.*`.
- CR-4 : matview gold `annual_site_consumption` (kWh/an par bâtiment), publiée en conteneur LDP
  `/gold/annual_site_consumption/` (export réglementaire).
- CR-5 : endpoint LLM `POST /app/llm` (fonction, pas une ressource de données : les données sont
  lues en LDP avec ACL/RLS) — **c'est cette CR qui crée le flux**, voir §4.6.

## 3. Catalogue étendu proposé (lots)

Colonnes : `role_min` · route · composant · via · CR serveur éventuel.

### Lot 1 — valeur immédiate, peu d'effet serveur
| slug | order | rôle | route | composant | via | config_schema (champs) | CR |
|---|---|---|---|---|---|---|---|
| `alert-rules` | 10 | gestionnaire | `/alerts` | `alert-list` | LDP `/gold/anomaly_candidates/` + `/buildings/` + prefs | `thresholds`: object (bâtiment→{kW, eur_day}) | — (évaluation front, badge UI) |
| `sla-dashboard` | 11 | gestionnaire | `/sla` | `sla-view` | LDP `/tickets/` + `/tickets/<pk>/versions/` | `sla_hours`: number (défaut 24) | CR-3 |
| `report-builder` | 12 | gestionnaire | `/reports` | `report-form` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | `period`: enum [day,week,month,year], `building`: string, `format`: enum [pdf,csv] | — |

### Lot 2
| slug | order | rôle | route | composant | via | config_schema | CR |
|---|---|---|---|---|---|---|---|
| `budget-tracker` | 20 | gestionnaire | `/budget` | `budget-gauge` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | `budget_kwh`: number (req), `budget_eur`: number, `alert_pct`: number (défaut 80) | — (calcul front) |
| `price-optimizer` | 21 | gestionnaire | `/optimize` | `shift-advisor` | LDP `/gold/price_hourly/` + `/gold/net_grid_hourly/` | `shiftable_kwh`: number, `window`: string (format `HH:MM-HH:MM`) | CR-1 + CR-0 |
| `pv-selfconsumption` | 22 | gestionnaire | `/pv` | `pv-gauge` | LDP `/gold/pv_performance_hourly/` + `/gold/net_grid_hourly/` | `battery_kwh`: number (défaut 0) | CR-0 |
| `benchmark` | 23 | gestionnaire | `/benchmark` | `benchmark-view` | LDP `/gold/annual_site_consumption/` + `/buildings/` | `metric`: enum [kwh_m2, eur_m2], `period`: enum [month,year], `ref_building`: string | CR-2 + CR-0/CR-4 |
| `regulatory-export` | 24 | gestionnaire | `/regulatory` | `regulatory-export` | LDP `/gold/annual_site_consumption/` | `year`: number, `format`: enum [csv,json] | CR-4 + CR-0 |

### Lot 3
| slug | order | rôle | route | composant | via | config_schema | CR |
|---|---|---|---|---|---|---|---|
| `weather-correlation` | 30 | gestionnaire | `/weather` | `weather-chart` | LDP `/gold/weather_hourly/` | `station`: string, `period`: enum [7d,30d,90d] | CR-0 |
| `city-events` | 31 | gestionnaire | `/city` | `city-feed` | LDP `/gold/city_event_hourly/` | `zone`: string, `radius_km`: number | CR-1 + CR-0 |
| `ai-assistant` | 32 | gestionnaire | `/assistant` | `ai-chat` | LDP (données, ACL/RLS) + endpoint LLM ORCE | `assets`: array (items string), `model`: string | CR-5 (endpoint LLM, voir §4.6) |
| `data-sharing` | 33 | admin | `/sharing` | `share-manager` | plan de contrôle DSP (cœur, existe) | `asset`: string, `consumer_did`: string, `duration_days`: number | — |

## 4. Décisions métier tranchées (points ouverts complétés)

1. **alert-rules** : évaluation **côté front** (confirmée) sur les données déjà fetchées ; canal de
   notification v1 = **badge UI uniquement** (pas d'email, pas de push). Format du champ `window`
   validé : `HH:MM-HH:MM` (regex `^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$`).
2. **sla-dashboard** : SLA = délai **création (`tickets.created_at`) → statut `RESOLVED`** (lu dans
   `app.versions`, CR-3) ; `sla_hours=24` est le seuil global par défaut, overridable par priorité
   via `thresholds`-like object optionnel. Un ticket RESOLVED au-delà du seuil = « SLA dépassé ».
3. **report-builder** : v1 = génération **PDF/CSV côté client** (jsPDF) depuis les données déjà
   fetchées, téléchargement direct. Le champ `recipients` (email) est **retiré du config_schema v1**
   — aucun canal mail n'existe ; envoi par mail = v2 (flux ORCE + SMTP).
4. **regulatory-export** : v1 = export **CSV annuel par site** (kWh/an), calcul **côté serveur**
   (matview `annual_site_consumption`, CR-4), pas côté front. Le format OPERAT exact reste à
   confirmer avec le métier (point ouvert), le CSV v1 est le sous-ensemble commun.
5. **benchmark** : `area_m2` en **saisie manuelle** dans le formulaire bâtiment (v1) ; import
   cadastral = v2.
6. **ai-assistant** : **aucun flux LLM n'existe aujourd'hui côté FAP-light**
   (`app-supervision-backend/flows/app-supervision.json` n'en contient pas ; AI Insight est un
   consommateur Postgres direct, décisions D-5/D-6, hors périmètre serveur). C'est **CR-5** qui crée
   l'endpoint `POST /app/llm` (fonction LLM — les données, elles, sont lues en **LDP** avec
   ACL/RLS). Contrat de l'endpoint : auth session OIDC, rate limit 10 req/min/user, audit
   `dsp.audit`. **Périmètre borné** : seules les assets listés dans `config.assets` sont
   lisibles — jamais tout le gold sans ACL.
7. **data-sharing** : le **lookup de contrat existe** côté cœur (état DSP en PostgreSQL + jeton de
   capacité à TTL, synthèse §4.1), mais le parcours self-service « offre → négociation → agreement »
   **n'est pas démontré** côté cœur — à confirmer avant dev. v1 : `share-manager` wrappe les
   endpoints core existants (catalogue + lookup), aucun nouveau serveur ; l'UI admin F6 en est la
   base.

## 5. Qualité / tests

- **CA-A8 (TCK)** : pour **chaque feature seedée**, test d'accès aux données effectif (pas seulement
  le menu) : rôle non autorisé → 403/404 sur la source de la feature (ACL/RLS) ; rôle autorisé →
  200. La matrice rôle × feature est générée depuis le seed.
- **i18n** : les `label` de `config_schema` ne sont **pas localisés en v1** (front FR-only, M4) —
  prévoir `label_i18n` en v2 pour éviter une migration de schéma.
- **CI** : check seed ↔ `orbit.json` (warning non bloquant tant que le composant n'est pas packagé,
  app-store-spec §1.9.8) ; livraison du seed **par lot** (lot 1 d'abord).

## 6. Points ouverts restants

- Format OPERAT exact (métier) ; import cadastral pour `area_m2` (v2) ; canal mail pour les rapports
  (v2) ; bac à sable du composant LLM (v2, voir app-store-spec Partie 2).
