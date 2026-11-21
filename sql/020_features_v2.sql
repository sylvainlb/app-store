-- ============================================================================
-- App store — 020_features_v2.sql : colonnes v2 (Partie 2 de app-store-spec.md)
--
-- À appliquer UNIQUEMENT en v2 (chargement à chaud de composants distants).
-- NE PAS appliquer en v1 : la Partie 1 est inchangée (L3, CA-B6) — la colonne
-- model_injected en particulier n'existe PAS dans 010_features.sql.
-- Rôle : admin. Paramètre psql : -v pod_host=<host du pod>
-- ============================================================================

ALTER TABLE app.features
  ADD COLUMN IF NOT EXISTS npm_package text,     -- package npm (v2, distant)
  ADD COLUMN IF NOT EXISTS version     text,     -- épinglée exacte, sans ^
  ADD COLUMN IF NOT EXISTS cdn_url     text,     -- jsDelivr
  ADD COLUMN IF NOT EXISTS sri         text,     -- SHA-384 du binaire
  ADD COLUMN IF NOT EXISTS tag         text,     -- tag du custom element distant
  ADD COLUMN IF NOT EXISTS model_injected boolean NOT NULL DEFAULT false;  -- modèle injecté via E11 (L3)

-- v2 : chaque entrée de prefs peut porter la version réellement chargée
-- (stockée dans le jsonb prefs, pas de colonne dédiée — §2.1 :
-- installed_version / installed_sri dans prefs.<slug>).
