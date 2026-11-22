-- ============================================================================
-- App store — 020_features_v2.sql: v2 columns (Part 2 of app-store-spec.md)
--
-- To apply ONLY in v2 (hot-loading of remote components).
-- DO NOT apply in v1: Part 1 is unchanged (L3, CA-B6) — the model_injected
-- column in particular does NOT exist in 010_features.sql.
-- Role: admin. psql parameter: -v pod_host=<pod host>
-- ============================================================================

ALTER TABLE app.features
  ADD COLUMN IF NOT EXISTS npm_package text,     -- npm package (v2, remote)
  ADD COLUMN IF NOT EXISTS version     text,     -- pinned exact, no ^
  ADD COLUMN IF NOT EXISTS cdn_url     text,     -- jsDelivr
  ADD COLUMN IF NOT EXISTS sri         text,     -- SHA-384 of the binary
  ADD COLUMN IF NOT EXISTS tag         text,     -- remote custom element tag
  ADD COLUMN IF NOT EXISTS model_injected boolean NOT NULL DEFAULT false;  -- model injected via E11 (L3)

-- v2: each prefs entry can carry the actually-loaded version
-- (stored in the prefs jsonb, no dedicated column — §2.1:
-- installed_version / installed_sri in prefs.<slug>).
