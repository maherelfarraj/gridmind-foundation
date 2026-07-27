create or replace function public.audit_thread_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  payload jsonb := to_jsonb(new);
begin
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (new.company_id, auth.uid(),
          tg_table_name || '.' || lower(tg_op), tg_table_name, new.id,
          case when tg_table_name = 'impact_assessments'
               then jsonb_build_object('status', payload->>'status', 'event_type', payload->>'event_type')
               else jsonb_build_object('link_type', payload->>'link_type') end);
  return new;
end $function$;

revoke all on function public.audit_thread_changes() from anon, authenticated, public;