-- 013_backfill_user_components_acl.sql — one-shot (role admin), idempotent.
-- workstream 3 rev 9 (F1.1, app-store-spec v0.7 §1.4.4): owner-only ACL on the private
-- components container /users/<pk>/components/ for users created BEFORE the trigger
-- extension. New users are covered by app_store_on_user_insert.
INSERT INTO auth.acl (resource_uri, subject, modes, inherited)
SELECT 'https://' || split_part(u.webid, '/', 3) || '/users/' || u.id::text || '/components/',
       u.webid, '{read,write,append,control}', true
  FROM app.users u
 WHERE to_regclass('app.user_components') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.acl a
                    WHERE a.resource_uri = 'https://' || split_part(u.webid, '/', 3) || '/users/' || u.id::text || '/components/'
                      AND a.subject = u.webid);

INSERT INTO auth.acl (resource_uri, subject, modes, inherited)
SELECT 'https://' || split_part(u.webid, '/', 3) || '/users/' || u.id::text || '/components/',
       'role:admin', '{read,write,append,control}', true
  FROM app.users u
 WHERE to_regclass('app.user_components') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.acl a
                    WHERE a.resource_uri = 'https://' || split_part(u.webid, '/', 3) || '/users/' || u.id::text || '/components/'
                      AND a.subject = 'role:admin');
