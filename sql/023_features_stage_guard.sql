-- Chantier 3 — v0.5 §1.4.3 (J8 ratified): POST /features/ is open to admin for DECLARATIVE rows
-- only. Code-stage rows (stage='code') remain seed-only / PATCH-metadata-only (v1 policy, §1.9.8).
-- The generic LDP POST runs as the runtime `app` role; seeds and migrations run as
-- admin/postgres at deploy time. So: reject stage='code' INSERTs coming from the runtime role.
-- SECURITY INVOKER (default): current_user is the real caller.
CREATE OR REPLACE FUNCTION app.app_store_stage_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage = 'code' AND current_user = 'app' THEN
    RAISE EXCEPTION 'code-stage catalogue rows are seed-only (app-store-spec v0.5 §1.4.3): POST /features/ accepts stage=declarative only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stage_guard ON app.features;
CREATE TRIGGER stage_guard BEFORE INSERT ON app.features
  FOR EACH ROW EXECUTE FUNCTION app.app_store_stage_guard();

COMMENT ON FUNCTION app.app_store_stage_guard() IS 'v0.5 two-stage store: LDP POST /features/ (runtime role app) may only create declarative rows; code rows are seeded at deploy (admin/postgres).';
