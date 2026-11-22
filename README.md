# @facis/app-store — v1

Catalogue of **toggleable features** for a FAP/Startin'blox app:
`<app-store>` (list + toggles + configuration) and `<app-menu>` (menu generated
from the preferences), plus the **SQL model** on the FAP-LDP server side.

Spec: `spec/app-store-spec.md` (v0.4, Part 1 = v1). Independent repository,
installable in any FAP/SIB app.

## Installation in an app (v1)

1. **Declarative model**: integrate `model/app-store.model.json` into the app's
   `config/model.json` — the FAP-LDP node applies it **at boot**
   (after the base's `core/sql/00*.sql`), idempotently (fap-ldp-spec §5).
   Then run the migration of existing users **once**:
   ```bash
   psql -v ON_ERROR_STOP=1 -v pod_host=<pod host> -f sql/012_backfill_prefs.sql
   ```
   `sql/010_features.sql` / `011_prefs.sql` are a **REFERENCE DDL generated
   from the JSON** (read/debug, do not apply by hand); the trigger bodies are in
   `sql/triggers/`. The catalogue seed is **app-specific**
   (suggested content: `../spec/app-store-catalogue.md`). `sql/020_features_v2.sql`
   is to be applied **only in v2**.

2. **Components**: mount `<app-menu>` in the shell (menu) and `<app-store>`
   on the `/store` route; declare the features in `orbit.json`
   (routes + components, pinned npm, SRI at build — §1.6.3).

3. **Boot**: configure the helpers once the session is known (§1.9.12):
   ```js
   import { appStore } from '@facis/app-store/components/shared/app-store-api.js';
   import '@facis/app-store/components/app-menu/app-menu.js';
   import '@facis/app-store/components/app-store/app-store.js';

   appStore.configure({
     podUrl: config.podUrl,                                  // e.g. https://<pod>/
     getWebid: () => session.info.webId,                     // webid claim → /prefs/<pk>
     getRole: () => window.appRole ?? 'manager',        // drives the admin UI, never the access
   });
   ```

## Consumed LDP contract (v1, §1.5)

| Call | Detail |
|---|---|
| `GET /features/` | container, `ldp:contains` = slugs |
| `GET /features/<slug>` | record (slug→id lookup on the PEP side, CA-A7) |
| `GET /prefs/<user_pk>` | prefs of the logged-in user; another user → **404** (§1.9.10) |
| `PATCH /prefs/<user_pk>` | merge-patch RFC 7386, body `{"prefs": {"<slug>": {"enabled": false}}}` (form R1) + `If-Match` (ETag); `412` → reload |
| `PATCH /features/<slug>` | admin: metadata only in v1 (§1.9.8) |

After each prefs PATCH, the package dispatches `save` on `document`
(`detail.resource.@id` = prefs IRI, §1.9.9): `<app-menu>` regenerates without
reload (CA-A1).

## Security (reminder §1.2.2 / §1.7)

The menu is UX, **not security**: any feature with a server-side effect stays guarded
server-side by ACL/PDP/RLS. Prefs owner-only (RLS
`auth.can`, 404 for another user); catalogue internal read, `admin`
write.

## Business feature components

This package only delivers the **mechanism** (`<app-store>`, `<app-menu>`, SQL model).
The catalogue's business components (alert-list, sla-view, budget-gauge, …) live in
the separate repository **`@facis/app-features`** — in v1 they are packaged in the app
and declared in its `orbit.json` (§1.6.3):

```js
import '@facis/app-features/components/features/index.js'; // 12 custom elements + FEATURE_COMPONENTS
```

## Tests

```bash
npm test            # unit + component tests (node --test tck/)
npm run test:e2e    # real LDP contract — needs APPSTORE_TEST_POD_URL + APPSTORE_TEST_TOKEN
```

- `tck/logic.test.js`: pure logic (rules §1.9).
- `tck/app-store-api.test.js`: PATCH contract (form R1, save, 412), guard.
- `tck/components.test.js`: CA-A1 (menu = enabled features, sorted), CA-A4 (guard).
- `tck/ldp-contract.test.js`: CA-A2 + CA-A7 against a real pod (e2e).
