create or replace function public.storage_company_id(p_name text)
returns uuid language plpgsql stable security definer
set search_path = public as $$
declare v_first text;
begin
  v_first := (storage.foldername(p_name))[1];
  begin
    return v_first::uuid;
  exception when others then
    return null;
  end;
end;
$$;
revoke all on function public.storage_company_id(text) from anon;
grant execute on function public.storage_company_id(text) to authenticated, service_role;

drop policy if exists company_files_select on storage.objects;
create policy company_files_select on storage.objects for select to authenticated
  using (bucket_id in ('drawings','photos','documents','closeout')
    and public.is_company_member(public.storage_company_id(name)));

drop policy if exists company_files_insert on storage.objects;
create policy company_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('drawings','photos','documents','closeout')
    and public.is_company_member(public.storage_company_id(name)));

drop policy if exists company_files_update on storage.objects;
create policy company_files_update on storage.objects for update to authenticated
  using (bucket_id in ('drawings','photos','documents','closeout')
    and public.is_company_member(public.storage_company_id(name)))
  with check (bucket_id in ('drawings','photos','documents','closeout')
    and public.is_company_member(public.storage_company_id(name)));

drop policy if exists company_files_delete on storage.objects;
create policy company_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('drawings','photos','documents','closeout')
    and public.is_company_admin(public.storage_company_id(name)));