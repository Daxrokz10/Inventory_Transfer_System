-- Add superadmin tier
-- superadmin: can create admins + store managers, full access
-- admin: can create store managers, full operational access
-- supervisor (store manager): site-level access

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';

-- Widen is_admin() to include superadmin (all RLS policies stay unchanged)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'superadmin')
  );
$$;

-- New helper used by server actions to gate admin-creation
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'superadmin'
  );
$$;

-- Make daksh the superadmin
UPDATE public.profiles
SET role = 'superadmin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'dakshgagnani@gmail.com'
);
