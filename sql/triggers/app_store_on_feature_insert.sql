-- app-store base trigger function — referenced by model/app-store.model.json
-- (triggers[1]). When the admin adds a feature, injects the default key
-- into all existing prefs (app-store-spec §1.9.4b).
-- SECURITY DEFINER: same (write into app.prefs despite FORCE RLS).
CREATE OR REPLACE FUNCTION app.app_store_on_feature_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE app.prefs p
     SET prefs = p.prefs || jsonb_build_object(NEW.slug, jsonb_build_object('enabled', NEW.default_enabled))
   WHERE p.deleted_at IS NULL
     AND NOT (p.prefs ? NEW.slug);
  RETURN NEW;
END $$;
