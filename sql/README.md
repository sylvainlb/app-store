# Modèle de l'app store — source de vérité : `model/app-store.model.json`

Le modèle métier est **déclaratif** : `../model/app-store.model.json` (fragment
`model.json`, appliqué **au boot par le nœud FAP-LDP** — fap-ldp-spec §5 : tables,
triggers, RLS, `dsp.asset_mapping`, ACL initiales). On l'intègre dans le
`config/model.json` de l'app (comme `examples/supervision/`).

## Installation (v1)

```bash
# 1. Intégrer model/app-store.model.json dans le config/model.json de l'app
#    (le nœud l'applique au boot, de façon idempotente, APRÈS core/sql/00*.sql).
# 2. Migration one-shot des users existants (seule étape manuelle, rôle admin) :
psql -v ON_ERROR_STOP=1 -v pod_host=<host du pod> -f sql/012_backfill_prefs.sql
# 3. Seed du catalogue : app-specific, dans le model.json de l'app
#    (contenu proposé : ../spec/app-store-catalogue.md).
```

## Contenu de sql/

| Fichier | Rôle |
|---|---|
| `triggers/app_store_on_user_insert.sql` | corps plpgsql du trigger user→prefs/ACL (référencé par le JSON) |
| `triggers/app_store_on_feature_insert.sql` | corps plpgsql du trigger feature→clé par défaut dans les prefs |
| `010_features.sql`, `011_prefs.sql` | **DDL de référence généré depuis le JSON** — lecture/debug/drift uniquement, ne pas éditer ni appliquer à la main |
| `012_backfill_prefs.sql` | **migration one-shot** (users existants au déploiement, §1.9.4c), idempotent, rôle `admin` |
| `020_features_v2.sql` | colonnes v2 — **uniquement en v2** (jamais en v1, L3) |

Pourquoi un JSON et pas que du SQL : le socle `core/sql/00*.sql` de FAP-LDP ne
contient que le générique (`auth.acl`, `app.versions`, triggers socle) ; le modèle
métier est déclaré en JSON et traduit en DDL au boot par le nœud — idempotent,
versionné, audité, et identique au DSL des packages injectés (E11,
`model-injection-spec.md` annexe A). Le SQL ici n'est qu'une vue de référence
(comme le « DDL de référence » de fap-ldp-spec §5.1).

Ressources LDP exposées (contrat §1.5) :

| Ressource | Lecture | Écriture |
|---|---|---|
| `GET /features/` , `/features/<slug>` | tous les users authentifiés du pod | `admin` |
| `GET/PATCH /prefs/<user_pk>` | propriétaire (+ `admin`) ; autre user → **404** | propriétaire (+ `admin`) |
