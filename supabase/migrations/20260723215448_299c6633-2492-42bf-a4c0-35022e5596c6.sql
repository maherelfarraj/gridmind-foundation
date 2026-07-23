-- Drop policies that reference the helper functions being replaced
DROP POLICY IF EXISTS "api_keys select company members" ON public.api_keys;
DROP POLICY IF EXISTS companies_delete ON public.companies;
DROP POLICY IF EXISTS companies_insert ON public.companies;
DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_update ON public.companies;
DROP POLICY IF EXISTS currencies_write ON public.currencies;
DROP POLICY IF EXISTS fx_rates_write ON public.fx_rates;
DROP POLICY IF EXISTS invites_admin_delete ON public.invites;
DROP POLICY IF EXISTS invites_admin_insert ON public.invites;
DROP POLICY IF EXISTS invites_admin_select ON public.invites;
DROP POLICY IF EXISTS invites_admin_update ON public.invites;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS user_roles_delete ON public.user_roles;
DROP POLICY IF EXISTS user_roles_insert ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update ON public.user_roles;
DROP POLICY IF EXISTS "webhook_deliveries select company members" ON public.webhook_deliveries;
DROP POLICY IF EXISTS "webhook_endpoints select company members" ON public.webhook_endpoints;

-- Drop helper functions in dependency order (assert_can_grant_role depends on has_role)
DROP FUNCTION IF EXISTS public.assert_can_grant_role(uuid, uuid, public.app_role);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.has_company_role(public.app_role);
DROP FUNCTION IF EXISTS public.is_company_member(uuid);

-- Recreate canonical helper functions
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(p_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = p_role
      AND ur.company_id = COALESCE(
        NULLIF(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid,
        (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.company_id = p_company_id
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_can_grant_role(
  p_target_user_id uuid, p_company_id uuid, p_role public.app_role
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_role = 'super_admin' AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden: only super_admin can grant super_admin';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = p_company_id
        AND ur.role = 'company_admin'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: actor is not company_admin of this company';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_target_user_id AND p.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'forbidden: cross-company role grant blocked';
  END IF;
END;
$$;

-- Revoke anon execution and grant to authenticated/service_role
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE ALL ON FUNCTION public.has_company_role(public.app_role) FROM anon;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_can_grant_role(uuid, uuid, public.app_role) FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_company_role(public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_can_grant_role(uuid, uuid, public.app_role) TO authenticated, service_role;

-- Restore affected RLS policies with identical names and semantics
CREATE POLICY "api_keys select company members" ON public.api_keys FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY companies_delete ON public.companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY companies_insert ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated
  USING (public.is_company_admin(id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.is_company_admin(id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY currencies_write ON public.currencies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY fx_rates_write ON public.fx_rates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY invites_admin_delete ON public.invites FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY invites_admin_insert ON public.invites FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY invites_admin_select ON public.invites FOR SELECT TO authenticated
  USING (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY invites_admin_update ON public.invites FOR UPDATE TO authenticated
  USING (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_company_member(company_id) OR (id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING ((id = auth.uid()) OR public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK ((id = auth.uid()) OR public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY user_roles_delete ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY user_roles_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_company_member(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY user_roles_update ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.is_company_admin(company_id) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "webhook_deliveries select company members" ON public.webhook_deliveries FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY "webhook_endpoints select company members" ON public.webhook_endpoints FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));