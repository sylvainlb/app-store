-- Fonction trigger du socle app-store — référencée par model/app-store.model.json
-- (triggers[1]). À l'ajout d'une feature par l'admin, injecte la clé par défaut
-- dans toutes les prefs existantes (app-store-spec §1.9.4b).
-- SECURITY DEFINER : idem (écriture dans app.prefs malgré FORCE RLS).
CREATE OR REPLACE FUNCTION app.app_store_on_feature_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE app.prefs p
     SET prefs = p.prefs || jsonb_build_object(NEW.slug, jsonb_build_object('enabled', NEW.default_enabled))
   WHERE p.deleted_at IS NULL
     AND NOT (p.prefs ? NEW.slug);
  RETURN NEW;
END $$;
