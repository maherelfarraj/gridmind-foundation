alter table public.invites add column if not exists role public.app_role;
alter table public.invites alter column role set not null;

drop policy if exists invites_admin_all on public.invites;
create policy invites_admin_all on public.invites
  for all to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));