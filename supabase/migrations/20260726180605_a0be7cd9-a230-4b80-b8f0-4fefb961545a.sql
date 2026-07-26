revoke all on public.ea_studies from anon;
revoke all on public.ea_study_revisions from anon;
revoke all on public.ea_studies from authenticated;
revoke all on public.ea_study_revisions from authenticated;
grant select, insert, update on public.ea_studies to authenticated;
grant select, insert on public.ea_study_revisions to authenticated;
grant all on public.ea_studies to service_role;
grant all on public.ea_study_revisions to service_role;