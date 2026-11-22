# App store model — source of truth: `model/app-store.model.json`

The business model is **declarative**: `../model/app-store.model.json` (`model.json`
fragment, applied **at boot by the FAP-LDP node** — fap-ldp-spec §5: tables,
triggers, RLS, `dsp.asset_mapping`, initial ACLs). You integrate it into the
app's `config/model.json` (like `examples/supervision/`).

## Installation (v1)

```bash
# 1. Integrate model/app-store.model.json into the app's config/model.json
#    (the node applies it at boot, idempotently, AFTER core/sql/00*.sql).
# 2. One-shot migration of existing users (the only manual step, role admin):
psql -v ON_ERROR_STOP=1 -v pod_host=<pod host> -f sql/012_backfill_prefs.sql
# 3. Catalogue seed: app-specific, in the app's model.json
#    (suggested content: ../spec/app-store-catalogue.md).
```

## Contents of sql/

| File | Role |
|---|---|
| `triggers/app_store_on_user_insert.sql` | plpgsql body of the user→prefs/ACL trigger (referenced by the JSON) |
| `triggers/app_store_on_feature_insert.sql` | plpgsql body of the feature→default key in prefs trigger |
| `010_features.sql`, `011_prefs.sql` | **REFERENCE DDL generated from the JSON** — read/debug/drift only, do not edit or apply by hand |
| `012_backfill_prefs.sql` | **one-shot migration** (existing users at deployment, §1.9.4c), idempotent, role `admin` |
| `020_features_v2.sql` | v2 columns — **v2 only** (never in v1, L3) |
| `130_features_catalogue_v2.sql` | v2 catalogue seed (12 remote business features), generated — do not edit by hand |
| `021_features_category.sql` | feature category (store section), backfill by slug, idempotent |

Why a JSON and not just SQL: the FAP-LDP base `core/sql/00*.sql` only contains the
generic parts (`auth.acl`, `app.versions`, base triggers); the business model is
declared in JSON and translated to DDL at boot by the node — idempotent,
versioned, audited, and identical to the DSL of injected packages (E11,
`model-injection-spec.md` annex A). The SQL here is only a reference view
(like the "reference DDL" of fap-ldp-spec §5.1).

Exposed LDP resources (contract §1.5):

| Resource | Read | Write |
|---|---|---|
| `GET /features/`, `/features/<slug>` | all authenticated users of the pod | `admin` |
| `GET/PATCH /prefs/<user_pk>` | owner (+ `admin`); another user → **404** | owner (+ `admin`) |
