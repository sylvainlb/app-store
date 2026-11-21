# Spécification — App store (catalogue de fonctionnalités activables)

Composant réutilisable permettant à une application FAP/Startin'blox de proposer un **catalogue de
fonctionnalités** que l'utilisateur active ou non, avec **configuration par fonctionnalité**, et un
**menu généré dynamiquement** depuis la configuration utilisateur.

- **Version** : 0.4 — document en **deux parties** : Partie 1 = v1 (à implémenter, précisions
  tranchées en §1.9), Partie 2 = v2 (spécifiée, non prioritaire)
- **Projet à part : oui** — dépôt/package indépendant, installable dans toute app FAP/SIB
- **Références** :
  - `supervision-energetique-front-technique.md` (§7 composants, §13 décisions)
  - `fap-ldp-spec.md` v0.4 (endpoint LDP, `app.*`, RLS/ACL, PEP, triggers génériques §5.1/5.2)
  - `../architecture-djangoldp/1_SIB_ARCHITECTURE.md` (sibStore, Orbit, sib-router, boilerplate, CDN/SRI)
  - `app-store-catalogue.md` (contenu proposé du catalogue `app.features` — spec à part)

---

# Partie 1 — v1 : fonctionnalités packagées, menu dynamique

## 1.1 Objet et périmètre (v1)

Deux blox livrés par le projet : `<app-store>` (liste du catalogue + toggles + formulaires de
configuration) et `<app-menu>` (menu de l'app généré depuis les préférences). Plus le **modèle
déclaratif** (catalogue + préférences) : fragment `model.json` appliqué au boot par le nœud FAP-LDP
(fap-ldp-spec §5), le seed du catalogue restant en SQL d'initdb côté app (§1.3).

En v1, seules des fonctionnalités **déjà packagées** dans l'app (déclarées dans `orbit.json`) sont
proposées : l'app store les active/désactive et les configure ; le menu et les guards de routes sont
dynamiques. Le chargement de composants distants est en Partie 2 (v2).

## 1.2 Principes

1. **Tout est ressource LDP** : catalogue et préférences vivent dans `app.*`, servis par l'endpoint
   FAP-LDP, lus/écrits via sibStore. **Rien n'est persisté en localStorage en v1** (le cache sibStore
   est en mémoire uniquement).
2. **Le menu est de l'UX, pas de la sécurité** : masquer une entrée ne désactive rien côté serveur —
   toute fonctionnalité à effet serveur reste gardée par ACL/PDP (ex. publication data space).
3. **Préférences par utilisateur, synchronisées** : une ressource par user, RLS `webid` — lisible/
   modifiable uniquement par son propriétaire (et `admin`).

## 1.3 Projet à part — layout proposé

```
app-store/                         ← dépôt indépendant (ex. facis/app-store)
├── components/                    ← package web components (boilerplate SIB)
│   ├── app-store/                 ← <app-store> : liste catalogue + toggles + config
│   └── app-menu/                  ← <app-menu> : menu dynamique depuis les prefs
│   └── shared/                    ← helpers livrés : window.appStore.isEnabled(slug),
│                                  ←   mePrefsIri(), AppStoreGuardMixin (§1.9.7)
├── model/
│   └── app-store.model.json       ← SOURCE DE VÉRITÉ du modèle : fragment model.json (tables,
│                                  ←   champs, RLS, ACL, asset_mapping, triggers référencés),
│                                  ←   intégré au model.json de l'app et appliqué AU BOOT par le
│                                  ←   nœud FAP-LDP (fap-ldp-spec §5 ; même DSL que E11, annexe A)
├── sql/
│   ├── triggers/                  ← corps plpgsql des 2 triggers référencés par le JSON
│   │   ├── app_store_on_user_insert.sql
│   │   └── app_store_on_feature_insert.sql
│   ├── 010_features.sql           ← DDL de RÉFÉRENCE généré depuis le JSON (debug/drift — ne PAS
│   │                              ←   appliquer à la main ; éditer le JSON)
│   ├── 011_prefs.sql              ← idem (app.prefs + RLS/ACL + CREATE TRIGGER)
│   ├── 012_backfill_prefs.sql     ← migration ONE-SHOT : backfill prefs/ACL des users existants
│   │                              ←   au déploiement (rôle admin, idempotent)
│   ├── 020_features_v2.sql        ← Partie 2 : colonnes v2 (npm/sri…) + model_injected
│                                  ←   (L3 : PAS en v1, Partie 1 inchangée)
│   └── README.md                  ← procédure d'installation
├── spec/                          ← cette spec (source : atlas/spec/app-store-spec.md)
└── tck/                           ← tests Cypress composants + e2e LDP
```

Installation dans une app (v1) : intégrer `model/app-store.model.json` dans le `model.json` de
l'app (appliqué au boot par le nœud, après `core/sql/00*.sql`), exécuter **une fois**
`sql/012_backfill_prefs.sql` (rôle `admin`), monter `<app-store>` / `<app-menu>` dans le shell
Orbit, déclarer les features dans `orbit.json`. **Le package livre la structure du modèle en JSON +
les triggers + la migration ; le seed du catalogue est fourni par l'app via un fichier SQL
d'initdb** (pattern `101_seed_demo.sql`, canal tranché avec `model-injection-spec.md` §1.4 — pas de
clé `seed` dans `model.json`), avec check CI seed ↔ `orbit.json` (§1.9.8). Contenu proposé :
`app-store-catalogue.md`.

**Frontière statique vs injecté (L2)** : le mécanisme app store lui-même (`app.features`,
`app.prefs`, `model/app-store.model.json`) est **statique** — déployé avec le serveur, identique
pour toutes les apps. Ce qui est **injecté à chaud**, c'est le modèle des *features tierces* : via
E11 (`model-injection-spec.md`, contrat `POST /admin/apps`, fragments de modèle, `app.app_packages`,
conteneurs `/apps/<slug>/…`, tables `store_<slug>_*`), utilisé par la Partie 2 en v2.

## 1.4 Modèle de données v1 (`app.*`)

Champs transverses sur **les deux tables** (bénéficient des triggers génériques fap-ldp §5.1/5.2) :
`created_at`, `updated_at` (+ trigger), `deleted_at` (tombstone), versioning via `app.versions`.
`published=false` dans `dsp.asset_mapping` pour `/features/` et `/prefs/` (interne pod, jamais exposé
en data space).

### 1.4.1 Catalogue — `app.features` (géré par `admin`)
| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigserial PK | clé interne (triggers du socle : `NEW.id`) |
| `slug` | text UNIQUE NOT NULL | identifiant stable (`building-map`, …) — IRI `/features/<slug>` (décision B2) |
| `title_i18n`, `description_i18n` | jsonb | **localisés dès la v1** : `{"fr": "…"}` (décision A2, §1.9.2) |
| `icon` | text | nom d'icône du set autorisé (Material Icons), fallback `extension` (§1.9.3) |
| `menu_order` | int NOT NULL DEFAULT 0 | ordre du menu ; tri = `(menu_order, slug)` (§1.9.1) |
| `component` | text | tag du custom element (packagé dans l'app en v1) |
| `route` | text | route Orbit associée |
| `role_min` | text DEFAULT 'all' | rôle minimal pour voir/activer la feature (`all` \| `technicien` \| `gestionnaire` \| `admin`) — filtrage menu + guard ; la sécurité reste côté ACL/PDP |
| `in_menu` | bool DEFAULT true | `false` = hors menu (outil, ex. app-store atteint via une icône header) ; la route reste accessible et gardée |
| `config_schema` | jsonb | méta-schéma §1.9.6 |
| `default_enabled` | bool | état par défaut (aussi utilisé si la clé manque dans les prefs) |
| `category` | text NULL | **rayon du store** (migration `021_features_category.sql`) : `supervision` \\| `operations` \\| `energy` \\| `compliance` \\| `tools` (valeurs seedées ; toute autre valeur = rayon nommé tel quel ; NULL = « Other »). Organise `<app-store>` en sections + filtres (§1.6.2) ; **n'a aucun effet sur le menu** (reste plat) ni sur la sécurité (ACL/PDP). Modifiable par l'admin via PATCH `/features/<slug>` |

LDP : conteneur `https://<pod>/features/`, ressources `/features/<slug>` — `resource_iri_pattern`
**custom** `/features/<slug>` posé dans `dsp.asset_mapping` (le PEP mappe tout placeholder nommé
sur sa colonne : `pkWhere = <param> = $n`) ; aucun changement du PEP, couvert par CA-A7. En v1 pas de
`POST /features/` (admin = métadonnées seules, §1.9.8) : le catalogue est peuplé par le seed.
Lecture : tous les users authentifiés du pod ; écriture : `admin`.
**ACL seed (M2)** : `foaf:Agent` + `inherited=true` en `read` sur `/features/` (les externes sont de
toute façon arrêtés à l'étape 1 du PDP, conteneur `published=false`) ; `role:admin` en `write` sur
`/features/`.

### 1.4.2 Préférences — `app.prefs` (une ligne par user)
| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigserial PK | clé interne (triggers du socle) |
| `user_id` | bigint UNIQUE NOT NULL, FK → app.users **ON DELETE CASCADE** (RGPD) | propriétaire — IRI `/prefs/<user_id>` (pattern custom sur `user_id`) |
| `prefs` | jsonb NOT NULL DEFAULT '{}' | `{"<slug>": {"enabled": bool, "config": {...}}}` |

LDP : ressource **unique** par utilisateur `https://<pod>/prefs/<user_id>` (décision B1/B3 :
ressource aplatie avec colonne jsonb, PATCH atomique — et non `/users/<pk>/prefs`).
PUT/PATCH merge-patch pour modifier. RLS : `auth.can` sur l'IRI → un utilisateur ne voit/modifie
**que** ses prefs ; pour un autre user le PDP rend **403** avant la RLS (décision §1.9.10 révisée :
403 uniforme avec l'inexistant — ne divulgue pas l'existence). Trigger à la création d'un user : prefs par défaut depuis
`app.features.default_enabled` **et** ACL owner-webid (read/write/control) sur `/prefs/<pk>` +
`role:admin` (M2) ; backfill des users existants au déploiement via `012_backfill_prefs.sql`
(prefs + ACL, §1.9.4). À l'ajout d'une feature par l'admin : trigger sur INSERT `app.features` qui
injecte la clé par défaut dans toutes les prefs existantes.

## 1.5 Contrat LDP exposé (v1)

- `GET /features/` → catalogue (conteneur, `ldp:contains` = slugs) ; `GET /features/<slug>` → fiche.
- `GET /prefs/<user_pk>` → prefs de l'utilisateur connecté (autre user → **403**, uniforme avec l'inexistant).
- `PATCH /prefs/<user_pk>` (merge-patch) — body conforme au mapping colonne→propriété, le jsonb
  n'est **pas** aplati à la racine (forme R1) : `{"prefs": {"building-map": {"enabled": false}}}`.
  **Sémantique constatée sur le serveur live (21/11) : le PEP remplace la colonne jsonb `prefs`
  entière** (pas de merge profond serveur) — le client fait donc un **read-modify-write** :
  il fusionne le patch avec son état courant (merge par slug, pour préserver `config` quand on ne
  touche qu'à `enabled`) et envoie l'objet `prefs` **complet**, protégé par `If-Match` → `412`
  en cas de conflit (§1.9.9). La colonne est lue en GET sous la clé sérialisée du mapping
  (`prefs`, `prefs:prefs`, `app_prefs:prefs`… — parsing générique côté client).
- Erreurs `dspace:Error` ; ETag/If-Match comme le reste de l'endpoint ; `412` → recharger les prefs +
  toast « modifié entre-temps » (§1.9.9).

## 1.6 Composants et comportement (v1)

### 1.6.1 `<app-menu>` (dans le shell)
- Lit `window.appStore.mePrefsIri()` (= `/prefs/<pk>` extrait du claim webid) via
  `window.sibStore.getData()` ; s'abonne au PubSub du store sur cet IRI et à l'événement `save`.
- Rend un `solid-link` par feature `enabled=true` **et** `role_min` compatible du rôle courant
  (correspondance exacte, comme les `roles` des routes d'orbit.json ; `admin` voit tout), triées par
  `(menu_order, slug)`, en joignant au catalogue (les slugs inconnus des prefs sont ignorés, §1.9.4).
- Guard de route : écoute de l'événement `navigate` dans le shell + helper `window.appStore
  .isEnabled(slug)` → feature désactivée ou inconnue → redirect `/` (§1.9.7).

### 1.6.2 `<app-store>` (route `/store`, tout utilisateur authentifié ; admin édite les métadonnées)
- **Organisation par cas d'usage (décision 21/11)** : le store n'est **pas** une liste plate —
  barre d'outils (champ **recherche** sur slug/titre/description + **chips de catégories** avec
  compteurs) puis **sections par rayon** (`category`, ordre fixe `supervision, operations, energy,
  compliance, tools`, inconnues par ordre alphabétique, sans catégorie en dernier « Other »).
  Recherche et chip sont combinables (intersection) ; état vide « No feature matches. ».
  Le **menu `<app-menu>` reste plat** — la catégorisation ne vit que dans `/store`.
- **Liste** : `ComponentObjectsHandler` sur `/features/` + prefs courante → toggle (switch) par
  feature ; badge « configuré » (définition §1.9.11) ; bouton « Configurer » **uniquement si la
  feature est activée ET `config_schema.fields` est non vide** (sinon rien à configurer / pas
  actif → bouton masqué, jamais affiché inactif).
- **Toggle** : PATCH merge-patch sur `/prefs/<user_pk>` avec body forme R1 §1.5
  `{"prefs": {…objet complet fusionné…}}` (read-modify-write + If-Match, sémantique §1.5) puis
  dispatch manuel de l'événement `save` (contrat §1.9.9) → `<app-menu>` et la route courante
  se mettent à jour à chaud.
- **Formulaire de config** : **modale dans `/store`** (§1.9.11), `solid-form` piloté par
  `config_schema`, écrivant la sous-clé `config` des prefs.
- **Admin (v1)** : édition des **métadonnées uniquement** des features déjà packagées
  (décision A8, §1.9.8) : title/description/icon/category/menu_order/config_schema/default_enabled.

### 1.6.3 Intégration Orbit (v1)
Toutes les features sont **déclarées au build** dans `orbit.json` (routes + composants, npm épinglé,
SRI au build). L'app store ne fait que les afficher/masquer/configurer — pas d'enregistrement
dynamique de composants en v1.

## 1.7 Sécurité (v1)

- Prefs : RLS/ACL owner-only (§1.4.2). Catalogue : lecture interne, écriture `admin`.
- Menu = UX uniquement ; jamais une barrière d'autorisation (§1.2.2).

## 1.8 Critères d'acceptation (v1)

- CA-A1 : `<app-menu>` affiche exactement les features `enabled=true` des prefs de l'utilisateur
  connecté, triées par `(menu_order, slug)` ; un PATCH de prefs met le menu à jour sans rechargement.
- CA-A2 : toggle dans `<app-store>` → PATCH merge-patch sur `/prefs/<user_pk>` avec body
  `{"prefs": {…}}` forme R1 (objet complet, read-modify-write §1.5) → version créée, read-after-write immédiat,
  config des autres features préservée ; un autre utilisateur qui GET mes prefs → **403** (uniforme
  avec une ressource inexistante — ne divulgue pas l'existence).
- CA-A3 : formulaire de config d'une feature écrit `config` conformément à `config_schema`
  (validation front en v1, §1.9.6).
- CA-A4 : route d'une feature désactivée → redirect `/` (guard shell + mixin).
- CA-A7 : `GET`/`PATCH`/`DELETE /features/<slug>` résolu via le pattern custom `/features/<slug>`
  (colonne `slug`, pas la PK) — prouvé par un test TCK.

## 1.9 Précisions tranchées (revues avant dev des composants)

1. **Ordre du menu** : `menu_order int NOT NULL DEFAULT 0` sur `app.features` ; tri du menu =
   `(menu_order ASC, slug ASC)`.
2. **i18n du catalogue (A2)** : `title_i18n`/`description_i18n` en **jsonb localisé dès la v1**
   (`{"fr": "…"}`) — le package est générique ; le front v1 est FR-only et lit `…_i18n[locale]` avec
   fallback `fr` puis `slug`. Pas de migration de schéma en v2.
3. **Icônes** : set autorisé = noms **Material Icons** ; fallback `extension` si le nom est inconnu.
4. **Features ajoutées/supprimées après coup** : (a) règle front « clé absente dans prefs =
   `default_enabled` » ; (b) trigger sur INSERT `app.features` qui injecte la clé par défaut dans
   toutes les prefs existantes ; (c) `012_backfill_prefs.sql` pour les users existants au
   déploiement ; (d) à la suppression d'une feature, le menu **joint au catalogue et ignore les
   slugs inconnus** des prefs, et un job de maintenance retire les clés fantômes des prefs jsonb.
5. **Champs transverses** : `created_at`/`updated_at` + trigger, versioning (`app.versions`),
   tombstone (`deleted_at`) sur `app.features` et `app.prefs` ; index sur `features.slug` (unique) ;
   `ON DELETE CASCADE` prefs→users ; `published=false` dans `dsp.asset_mapping` pour `/features/`
   et `/prefs/`.
6. **Validation de `config` contre `config_schema` (A6)** : **front seul en v1** (solid-form) ;
   validation PEP (409 `dspace:Error`, comme la décision K des transitions) prévue **en v2
   (post-v1)** (M3 : pas de « v2.1 » dans le phasage). Méta-schéma exact de `config_schema` (N1 :
   élargi à `object` et `array` pour couvrir le catalogue) :
   `{"fields": [{"key": string, "label": string,
   "type": "string"|"number"|"boolean"|"enum"|"object"|"array",
   "default"?: any, "options"?: string[] (si enum), "items"?: "string" (si array),
   "required"?: bool}]}` — `object` = jsonb libre, `array` = tableau de string.
   Note (M4) : les `label` ne sont **pas localisés** en v1 (front FR-only) — à localiser en v2
   (`label_i18n`) pour éviter une migration de schéma.
7. **Guard de route** : sib-router/Orbit n'a pas de guard natif → implémentation : le shell écoute
   `navigate` et redirige `/` si `!window.appStore.isEnabled(slug)` ; le package livre le helper
   `window.appStore.isEnabled(slug)` (lit les prefs en cache) et un `AppStoreGuardMixin` pour les
   composants de route, afin de ne rien réimplémenter par composant métier.
8. **Cohérence catalogue ↔ orbit.json (A8)** : en v1, l'admin édite **uniquement les métadonnées** des
   features déjà déclarées dans `orbit.json` (ajouter une feature = repackager l'app). Le menu
   n'affiche que les features dont la route existe (`window.orbit.getRoute`), et un check CI au build
   avertit si le seed du catalogue référence un composant/route inconnu.
9. **Contrat de l'événement `save`** : `sibStore.patch()` n'émet pas `save` tout seul — après le
   PATCH des prefs, `<app-store>` fait
   `document.dispatchEvent(new CustomEvent("save", {detail: {resource: {"@id": prefsIri}}}))` ;
   `<app-menu>` se rafraîchit via son abonnement PubSub sur cet IRI. `412` → recharger les prefs +
   toast « modifié entre-temps ».
10. **403 vs 404 pour les prefs d'un autre user** : décision révisée après test réel — le PEP rend
    **403** (le PDP bloque sur l'ACL avant la RLS ; une ressource inexistante sous un conteneur connu
    rend aussi 403, donc la réponse est uniforme et ne divulgue pas l'existence). Écrit dans le TCK (CA-A2).
11. **UX du formulaire de config** : « Configurer » ouvre une **modale dans `/store`** (pas de route
    dédiée en v1). Badge « configuré » = `config` non vide **et** différent des `default` du
    `config_schema` (comparaison JSON).
12. **`<me>`** : le pk est extrait du claim `webid` (`https://<pod>/users/<pk>` → `/prefs/<pk>`) via
    le helper `window.appStore.mePrefsIri()` ; un webid hors pod est **interdit en v1** (403).

---

# Partie 2 — v2 : chargement à chaud de composants distants (spécifié, non prioritaire)

Tout ce qui suit **s'ajoute** à la Partie 1 sans la modifier (les colonnes v2 vivent dans
`sql/020_features_v2.sql`, appliquées uniquement en v2).

## 2.1 Ce que v2 ajoute au modèle de données

- `app.features` + colonnes : `npm_package`, `version` (exacte, sans `^`), `cdn_url` (jsDelivr),
  `sri` (SHA-384), `tag` (custom element distant).
- `app.prefs.prefs` : chaque entrée de feature peut porter `installed_version`, `installed_sri`
  (version réellement chargée).

## 2.2 Ce que v2 implique techniquement

1. **Loader dynamique** : à l'activation d'une feature distante, le shell importe le module ES :
   `await import(cdn_url)` puis monte `<tag>` dans un hôte `<dynamic-feature>`.
2. **SRI et import dynamique — point dur** : l'attribut `integrity` ne s'applique qu'aux balises
   `<script>`, **pas** à `import()`. Il faut donc vérifier manuellement : `fetch(cdn_url)` →
   `crypto.subtle.digest('SHA-384', buf)` → comparaison avec `sri` du catalogue → import via
   `URL.createObjectURL(new Blob([src], {type:'text/javascript'}))`. Alternative plus simple :
   whitelist d'origines CDN + version épinglée, sans vérification de hash. **Décision v2 retenue :
   fetch + vérification SHA-384 manuelle avant import** (sinon un CDN compromis = XSS signé).
3. **Confirmation et audit** : modale **dans `/store`** (pas de `window.confirm` brut) :
   titre/description de la feature, `package@version`, empreinte SHA-384 **raccourcie** (complète
   au survol) et mention de confiance « le composant tourne avec vos droits » (§2.2.6) ; bouton
   Installer désactivé si le sri est absent. L'installation est enregistrée dans les prefs
   (`installed_version`, `installed_sri`) et auditée côté serveur (`dsp.audit` / log ORCE :
   webid, slug, version, ts).
4. **Révocation** : depuis l'app store, « désinstaller » → prefs mises à jour, module retiré du
   cache, élément désenregistré. Les features packagées (v1) ne sont pas « désinstallables ».
5. **Cache** : Cache API / service worker pour l'offline ; **upgrade** : si le catalogue annonce
   une version > `installed_version` → prompt de mise à jour (re-vérification du nouveau sri).
6. **Modèle de confiance** : un composant chargé a accès au `fetchAuthn` de l'utilisateur — donc à
   tout ce que l'utilisateur peut lire/écrire. La décision de confiance se prend **à
   l'installation** (UI explicite). Option post-v1 : bac à sable iframe + pont postMessage restreint
   (le composant distant ne touche pas directement à fetchAuthn).
7. **Menu** : `<app-menu>` inchangé (il lit les prefs) ; la route d'une feature distante est montée
   à la volée via `<dynamic-feature>`.

## 2.3 Ce que v2 ne change pas

Le PDP/ACL/RLS serveur : un composant distant tourne avec les credentials de l'utilisateur, rien de
plus. Les features à effet serveur restent gardées par le serveur quoi qu'affiche le menu.

## 2.4 Sécurité (v2)

- En plus de la sécurité v1 (§1.7) : version épinglée + sri vérifié avant chaque import ;
  confirmation utilisateur ; audit ; révocation.

## 2.5 Critères d'acceptation (v2)

- CA-A5 (v2) : activation d'une feature distante sans sri valide → refusée ; avec sri valide →
  import vérifié, composant monté, menu mis à jour ; révocation → composant retiré.
- CA-A6 (v2) : catalogue v2 (version > installée) → prompt upgrade avec re-vérification du hash.

## 2.6 Phasage et points ouverts (v2)

- **v1 à livrer d'abord** (Partie 1) : `model/app-store.model.json` + `sql/012_backfill_prefs.sql`,
  `<app-store>` + `<app-menu>`, intégration Orbit dans l'app de supervision (features de base, slugs
  du seed alignés sur `orbit.json` : `dashboard`, `anomalies`, `tickets`, `interventions`,
  `building-detail`, `store`, `admin` — voir `app-store-catalogue.md` §1).
- **Chaînon back (L4)** : une feature distante qui a besoin de **tables** ne les crée pas elle-même
  côté front — elle passe par **E11** (`model-injection-spec.md` : `POST /admin/apps`, fragment de
  modèle, conteneurs `/apps/<slug>/…`, tables `store_<slug>_*` ; injection à chaud en v2 via E12).
  La Partie 2 ne décrit que le chargement du binaire (npm/CDN + SRI) ; le modèle est du ressort
  d'E11.

## 2.7 v2 — décisions tranchées et état (21/11)

- **O-A1 tranché : fetch + vérification SHA-384 manuelle avant `import()`** (décision retenue §2.2.2),
  implémenté dans `components/shared/loader.js` (`loadRemoteModule` : fetch → `crypto.subtle.digest`
  → compare base64 en temps constant → import via blob URL). **Le cache ne dispense pas du sri** :
  un hit de cache avec un sri différent de celui du catalogue → `SriMismatchError` (sinon un
  catalogue upgradé non re-vérifié serait servi depuis le cache). Refus si sri absent (`MissingSriError`).
- **O-A2 tranché pour la v2 : confiance à l'installation** (UI explicite « installer <pkg>@<version> ?
  » affichant le sri, §2.2.3) ; le bac à sable iframe + pont postMessage reste **post-v2**.
- **E11 câblé dans le déploiement** : fragment de flow
  `fap-ldp/ext/model-injection/compose/flows/model-injection.json` (nœuds `fap-ldp-mi-boot` +
  `fap-ldp-mi-admin`, DSN `${PG_ADMIN_DSN}`), assemblé par `assemble-flows.sh`, package monté dans
  ORCE (`/data/node_modules/node-red-contrib-fap-ldp-model-injection`). Le core réserve déjà
  `/admin/*`, `/apps/`, `/apps/<slug>/meta` à l'ext. Vérifié en live : `POST /admin/apps` → 201,
  conteneur `/apps/<slug>/<table>/` servi par le PEP (cache mappings 60 s), upsert `app.features`
  avec `model_injected=true`, 409 au re-POST, 422 `invalid_identifier`.
- **Front v2 livré** : `components/shared/loader.js` (SRI + import + cache/evict),
  `components/shared/install.js` (install/uninstall/upgrade orchestrés, `installPatch`/
  `uninstallPatch` avec `installed_version`/`installed_sri` dans les prefs §2.1),
  `components/dynamic-feature/dynamic-feature.js` (montage à la volée d'une feature distante,
  §2.2.7 — le shell monte `<dynamic-feature slug>` pour une route dont le composant n'est pas
  packagé), UI dans `<app-store>` (badges « distante » / « vX » / « upgrade dispo », bouton
  « Mettre à jour » CA-A6).
- **Badges typés en couleur** (décision 21/11) : `configured` (teal) si `config` non vide ;
  `installed vX` (vert) si la feature distante a `installed_version`+`installed_sri` dans les
  prefs ; `remote · not installed` (indigo) **uniquement si la feature distante est désactivée
  et non installée** — une feature activée est chargée à la navigation (bundle + SRI vérifié +
  `installPatch` enregistré), donc afficher « not installed » sur une feature active serait
  trompeur (les features `default_enabled=true` n'ont jamais ce badge) ; `update available`
  (ambre) si version catalogue > `installed_version` (CA-A6). Icônes en **SVG inline**
  (`components/shared/icons.js`) : les ligatures Material Icons ne pénètrent pas le shadow DOM.
  TCK : `tck/v2.test.js` (12 tests) + `tck/v2-e2e.test.js` (e2e live :
  install E11 → catalogue v2 → prefs → SRI réel → révocation), lancé via `npm run test:e2e`.
- **Grammaire des slugs harmonisée en v2** : `app.features.slug` accepte désormais `_` (les slugs
  E11 sont en `^[a-z][a-z0-9_]{1,30}$`) — contrainte widenée dans `020_features_v2.sql`.
- **Socle v2 appliqué en live** : `020_features_v2.sql` (colonnes `npm_package`, `version`,
  `cdn_url`, `sri`, `tag`, `model_injected`), copié en migration custom
  `app-supervision-backend/sql/120_app_store_features_v2.sql` (rejoué au boot, idempotent).
- **v2 = tout par le CDN** (décision 21/11) : plus aucun composant métier packagé dans
  l'app. Les features de base (dashboard, anomalies, tickets, interventions,
  building-detail, admin) sont buildées en bundles par `app-supervision/scripts/build-features.mjs`
  (`npm run build:features` → `public/features-dist/<slug>.js` + manifest sri) et rendues
  **distantes** par le seed `131_base_features_v2.sql`. Le shell ne précharge plus rien :
  `render()` charge le bundle de la feature (SRI vérifié avant import, CA-A5) puis monte les
  tags de la route ; les lots sans composants déclarés passent par `<dynamic-feature>`.
  Seul le mécanisme app store (`<app-store>`/`<app-menu>`, route `/store`) reste packagé —
  c'est le bootstrap qui permet d'installer les autres. En mode fixtures (VITE_FIXTURES=1),
  les composants métier sont chargés en chunks séparés à la demande.
- **Catalogue v2 peuplé** : les 12 features métier des lots 1–3 (`app-store-catalogue.md` §3,
  composants du dépôt `app-features/`) sont seedées comme features **distantes** par
  `app-store/sql/130_features_catalogue_v2.sql` (généré par `app-features/scripts/build.mjs` :
  bundle ESM par slug → `dist/<slug>.js`, `sri` = sha384 réelle, `dist/manifest.json`).
  `cdn_url` en relatif same-origin `/features-dist/<slug>.js` en dev (servi depuis
  `app-supervision/public/features-dist/`) ; prod = jsDelivr du package publié. Migration
  `120…` + `130…` rejouées au boot ; vérifié en live : `GET /features/` → 19 features,
  `GET /features/pv-selfconsumption` → `tag`/`sri`/`cdn_url`/`version` exposés, e2e
  d'installation réelle (fetch bundle → SRI → `<pv-gauge>` enregistré → prefs
  `installed_sri`) verte. Routes des 12 features dans `orbit.json` (`menu:false`,
  `components:[]`, `dynamic:true`) → montées via `<dynamic-feature>` quand enabled.
