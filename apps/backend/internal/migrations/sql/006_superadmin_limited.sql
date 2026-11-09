-- R2C2B-SA01: Superadmin identity/role administration ONLY.
-- Deliberate least-privilege revocation of excess role-permission links;
-- no user, document, business data, access-grant or session rows are deleted.
DELETE FROM sdl_role_permissions
WHERE role_key = 'superadmin'
AND permission_key NOT IN ('identity.users.manage', 'identity.roles.manage');

-- Preserve the required permissions if an older environment missed them.
INSERT INTO sdl_role_permissions(role_key, permission_key) VALUES
 ('superadmin', 'identity.users.manage'),
 ('superadmin', 'identity.roles.manage')
ON CONFLICT DO NOTHING;
