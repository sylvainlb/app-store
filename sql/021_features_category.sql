-- ============================================================================
-- App store — 021_features_category.sql: category (section) of the catalogue
-- features, to organize <app-store> into sections + filters (revised spec §1.6.2:
-- "the store is organized by use case, the menu stays flat").
--
-- Role: admin. Idempotent: replayed at boot (like 020/130).
-- The category is a simple nullable text (no reference table):
-- the admin can change it via PATCH /features/<slug> (store admin modal).
-- Exposed in LDP as app_features:category, read by <app-store>.
-- ============================================================================

ALTER TABLE app.features ADD COLUMN IF NOT EXISTS category text;

-- Backfill by slug (only touches NULLs → idempotent). Suggested values:
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
  ('ai-assistant', 'demo_weather', 'admin', 'store',
   'model-editor', 'model-registry', 'ui-editor', 'ai-editor', 'my-apps'); -- editors + registre + "Mes apps" hub (workstreams 2-4/5)

CREATE INDEX IF NOT EXISTS features_category_idx ON app.features (category);
