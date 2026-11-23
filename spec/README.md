# Specs of the app-store component

- `app-store-spec.md` — **master copy** (English pivot, per the transverse convention:
  English everywhere, other languages in locales only). Single source of truth for the
  app-store mechanism. Other repos must **link to it, never copy it**:
  - `../../spec/app-store-spec.md` (workspace hub) → symlink here
  - `../../app-features/spec/app-store-spec.md` → symlink here
- `app-store-catalogue.md` — master copy of the catalogue *content* spec (seed of
  `app.features`); `../../spec/app-store-catalogue.md` → symlink here.
- `locales/app-store-spec.fr.md` — French translation (locale, regenerated from the
  master; never edited independently).

Rule: any change to the app-store mechanism is made here first, then the J8-style
ratifications reference this file. Duplicated copies have already diverged once
(3 copies, 3 checksums) — do not reintroduce copies.
