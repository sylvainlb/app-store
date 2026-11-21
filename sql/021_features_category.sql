-- ============================================================================
-- App store — 021_features_category.sql : catégorie (rayon) des features du
-- catalogue, pour organiser <app-store> en sections + filtres (spec §1.6.2
-- révisée : « le store est organisé par cas d'usage, le menu reste plat »).
--
-- Rôle : admin. Idempotent : rejoué au boot (comme 020/130).
-- La catégorie est un simple texte nullable (pas de table de référence) :
-- l'admin peut la modifier par PATCH /features/<slug> (modale admin du store).
-- Exposée en LDP comme app_features:category, lue par <app-store>.
-- ============================================================================

ALTER TABLE app.features ADD COLUMN IF NOT EXISTS category text;

-- Backfill par slug (ne touche que les NULL → idempotent). Valeurs proposées :
UPDATE app.features SET category = 'supervision'
  WHERE category IS NULL AND slug IN
  ('dashboard', 'building-detail', 'anomalies', 'alert-rules', 'sla-dashboard', 'weather-correlation');

UPDATE app.features SET category = 'operations'
  WHERE category IS NULL AND slug IN
  ('tickets', 'interventions', 'city-events');

UPDATE app.features SET category = 'energy'
  WHERE category IS NULL AND slug IN
  ('pv-selfconsumption', 'price-optimizer', 'budget-tracker', 'benchmark');

UPDATE app.features SET category = 'compliance'
  WHERE category IS NULL AND slug IN
  ('report-builder', 'regulatory-export', 'data-sharing');

UPDATE app.features SET category = 'tools'
  WHERE category IS NULL AND slug IN
  ('ai-assistant', 'demo_meteo', 'admin', 'store');

CREATE INDEX IF NOT EXISTS features_category_idx ON app.features (category);
