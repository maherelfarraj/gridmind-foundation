alter table public.companies add column if not exists legal_name text;
alter table public.companies add column if not exists contact_email text;
update public.companies set legal_name = name where legal_name is null;

drop policy if exists companies_super_admin_all on public.companies;
create policy companies_super_admin_all on public.companies
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'super_admin'));