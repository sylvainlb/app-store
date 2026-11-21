# @facis/app-store — v1

Catalogue de **fonctionnalités activables** pour une app FAP/Startin'blox :
`<app-store>` (liste + toggles + configuration) et `<app-menu>` (menu généré
depuis les préférences), plus le **modèle SQL** côté serveur FAP-LDP.

Spec : `spec/app-store-spec.md` (v0.4, Partie 1 = v1). Dépôt indépendant,
installable dans toute app FAP/SIB.

## Installation dans une app (v1)

1. **Modèle déclaratif** : intégrer `model/app-store.model.json` dans le
   `config/model.json` de l'app — le nœud FAP-LDP l'applique **au boot**
   (après `core/sql/00*.sql` du socle), de façon idempotente (fap-ldp-spec §5).
   Puis exécuter **une seule fois** la migration des users existants :
   ```bash
   psql -v ON_ERROR_STOP=1 -v pod_host=<host du pod> -f sql/012_backfill_prefs.sql
   ```
   `sql/010_features.sql` / `011_prefs.sql` sont un **DDL de référence généré
   depuis le JSON** (lecture/debug, ne pas appliquer à la main) ; les corps des
   triggers sont dans `sql/triggers/`. Le seed du catalogue est **app-specific**
   (contenu proposé : `../spec/app-store-catalogue.md`). `sql/020_features_v2.sql`
   est à appliquer **uniquement en v2**.

2. **Composants** : monter `<app-menu>` dans le shell (menu) et `<app-store>`
   sur la route `/store` ; déclarer les features dans `orbit.json`
   (routes + composants, npm épinglé, SRI au build — §1.6.3).

3. **Boot** : configurer les helpers une fois la session connue (§1.9.12) :
   ```js
   import { appStore } from '@facis/app-store/components/shared/app-store-api.js';
   import '@facis/app-store/components/app-menu/app-menu.js';
   import '@facis/app-store/components/app-store/app-store.js';

   appStore.configure({
     podUrl: config.podUrl,                                  // ex. https://<pod>/
     getWebid: () => session.info.webId,                     // claim webid → /prefs/<pk>
     getRole: () => window.appRole ?? 'gestionnaire',        // pilote l'UI admin, jamais l'accès
   });
   ```

## Contrat LDP consommé (v1, §1.5)

| Appel | Détail |
|---|---|
| `GET /features/` | conteneur, `ldp:contains` = slugs |
| `GET /features/<slug>` | fiche (lookup slug→id côté PEP, CA-A7) |
| `GET /prefs/<user_pk>` | prefs de l'utilisateur connecté ; autre user → **404** (§1.9.10) |
| `PATCH /prefs/<user_pk>` | merge-patch RFC 7386, body `{"prefs": {"<slug>": {"enabled": false}}}` (forme R1) + `If-Match` (ETag) ; `412` → recharger |
| `PATCH /features/<slug>` | admin : métadonnées uniquement en v1 (§1.9.8) |

Après chaque PATCH des prefs, le package dispatch `save` sur `document`
(`detail.resource.@id` = IRI des prefs, §1.9.9) : `<app-menu>` se régénère sans
rechargement (CA-A1).

## Sécurité (rappel §1.2.2 / §1.7)

Le menu est de l'UX, **pas de la sécurité** : toute fonctionnalité à effet
serveur reste gardée côté serveur par ACL/PDP/RLS. Prefs owner-only (RLS
`auth.can`, 404 pour un autre user) ; catalogue lecture interne, écriture
`admin`.

## Composants features métier

Ce package ne livre que le **mécanisme** (`<app-store>`, `<app-menu>`, modèle SQL).
Les composants métier du catalogue (alert-list, sla-view, budget-gauge, …) vivent
dans le dépôt à part **`@facis/app-features`** — en v1 ils sont packagés dans l'app
et déclarés dans son `orbit.json` (§1.6.3) :

```js
import '@facis/app-features/components/features/index.js'; // 12 custom elements + FEATURE_COMPONENTS
```

## Tests

```bash
npm test            # tests unitaires + composants (node --test tck/)
npm run test:e2e    # contrat LDP réel — nécessite APPSTORE_TEST_POD_URL + APPSTORE_TEST_TOKEN
```

- `tck/logic.test.js` : logique pure (règles §1.9).
- `tck/app-store-api.test.js` : contrat PATCH (forme R1, save, 412), guard.
- `tck/components.test.js` : CA-A1 (menu = features enabled, triées), CA-A4 (guard).
- `tck/ldp-contract.test.js` : CA-A2 + CA-A7 contre un vrai pod (e2e).
