-- 1. Server-only SECURITY DEFINER entry points: revoke direct API execution.
revoke execute on function public.consume_rate_limit(text, integer, numeric) from anon, authenticated;
revoke execute on function public.resolve_share_link(text) from anon, authenticated;
revoke execute on function public.get_po_by_share_token(uuid) from anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, numeric) to service_role;
grant execute on function public.resolve_share_link(text) to service_role;
grant execute on function public.get_po_by_share_token(uuid) to service_role;

-- 2. approvals: company scope on update.
drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals
for update to authenticated
using (
  public.is_company_member(company_id)
  and (approver_id = auth.uid() or public.has_company_role('company_admin'::app_role))
)
with check (
  public.is_company_member(company_id)
  and (approver_id = auth.uid() or public.has_company_role('company_admin'::app_role))
);

-- 3. portal_tickets: company scope on update.
drop policy if exists tickets_update on public.portal_tickets;
create policy tickets_update on public.portal_tickets
for update to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_company_role('company_admin'::app_role)
    or public.has_company_role('project_admin'::app_role)
    or public.has_company_role('om_admin'::app_role)
  )
)
with check (
  public.is_company_member(company_id)
  and (
    public.has_company_role('company_admin'::app_role)
    or public.has_company_role('project_admin'::app_role)
    or public.has_company_role('om_admin'::app_role)
  )
);

-- 4. project_export_locks: add WITH CHECK mirroring USING.
drop policy if exists export_locks_update on public.project_export_locks;
create policy export_locks_update on public.project_export_locks
for update to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_company_role('company_admin'::app_role)
    or public.has_company_role('project_admin'::app_role)
    or public.has_company_role('finance_admin'::app_role)
  )
)
with check (
  public.is_company_member(company_id)
  and (
    public.has_company_role('company_admin'::app_role)
    or public.has_company_role('project_admin'::app_role)
    or public.has_company_role('finance_admin'::app_role)
  )
);

-- 5. ifc_releases: add WITH CHECK mirroring USING.
drop policy if exists ifc_releases_update_admin on public.ifc_releases;
create policy ifc_releases_update_admin on public.ifc_releases
for update to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_role(auth.uid(), 'engineering_admin'::app_role)
    or public.has_role(auth.uid(), 'project_admin'::app_role)
    or public.has_role(auth.uid(), 'company_admin'::app_role)
    or public.has_role(auth.uid(), 'super_admin'::app_role)
  )
)
with check (
  public.is_company_member(company_id)
  and (
    public.has_role(auth.uid(), 'engineering_admin'::app_role)
    or public.has_role(auth.uid(), 'project_admin'::app_role)
    or public.has_role(auth.uid(), 'company_admin'::app_role)
    or public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- 6. project_financial_config: require company membership, not just role.
drop policy if exists project_financial_config_fin on public.project_financial_config;
create policy project_financial_config_fin on public.project_financial_config
for all to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_company_role('finance_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  )
)
with check (
  public.is_company_member(company_id)
  and (
    public.has_company_role('finance_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  )
);