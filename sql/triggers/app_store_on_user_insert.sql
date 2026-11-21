-- Fonction trigger du socle app-store — référencée par model/app-store.model.json
-- (triggers[0]). Corps plpgsql : la logique de trigger ne peut pas être purement
-- déclarative ; le JSON déclare la table/l'événement/le fichier, le SQL porte le corps.
--
-- Trigger à la création d'un user (app-store-spec §1.4.2) : prefs par défaut depuis
-- app.features.default_enabled ET ACL owner-webid (read/write/control) sur
-- /prefs/<pk> + role:admin (M2).
-- SECURITY DEFINER : FORCE ROW LEVEL SECURITY filtre même le owner (fap-ldp-spec
-- §7.2) — la fonction est créée par le rôle admin (BYPASSRLS).
-- Le host du pod est dérivé du webid (https://<host>/users/<pk>) : pas de
-- substitution de placeholder possible dans un corps de fonction.
CREATE OR REPLACE FUNCTION app.app_store_on_user_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_host  text := split_part(NEW.webid, '/', 3);
  v_prefs jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(slug, jsonb_build_object('enabled', default_enabled)), '{}'::jsonb)
    INTO v_prefs
    FROM app.features
   WHERE deleted_at IS NULL;

  INSERT INTO app.prefs (user_id, prefs) VALUES (NEW.id, v_prefs);

  INSERT INTO auth.acl (resource_uri, subject, modes, inherited) VALUES
    ('https://' || v_host || '/prefs/' || NEW.id::text, NEW.webid, '{read,write,control}', false),
    ('https://' || v_host || '/prefs/' || NEW.id::text, 'role:admin', '{read,write,control}', false);
  RETURN NEW;
END $$;
