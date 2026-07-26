alter table public.project_export_locks drop constraint if exists project_export_locks_export_type_check;
alter table public.project_export_locks add constraint project_export_locks_export_type_check
  check (export_type in ('proposal_pdf','proposal_pptx','weekly_client_report','om_report','turnover_pack','audit_pack','csv','sld_schedule','sld_revision_diff','sld_drawing'));