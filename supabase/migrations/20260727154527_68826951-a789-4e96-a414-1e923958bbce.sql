create or replace function public.close_change_request(
  p_id uuid,
  p_closure_notes text,
  p_updated_documents jsonb default '[]'::jsonb,
  p_updated_asbuilts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_open int;
  v_evidence jsonb;
begin
  select count(*) into v_open from public.moc_implementation_tasks
   where change_request_id = p_id and status = 'pending';
  if v_open > 0 then raise exception 'open_tasks_remaining:%', v_open; end if;

  -- Roll up task evidence so closure carries the implementation record.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_evidence
    from public.moc_implementation_tasks t
    cross join lateral jsonb_array_elements(coalesce(t.evidence, '[]'::jsonb)) e
   where t.change_request_id = p_id;

  return public.transition_change_request(p_id, 'closed', jsonb_build_object(
    'closure_notes', p_closure_notes,
    'updated_documents', p_updated_documents,
    'updated_asbuilts', p_updated_asbuilts)
    || case when jsonb_array_length(v_evidence) > 0
            then jsonb_build_object('implementation_evidence', v_evidence)
            else '{}'::jsonb end);
end $function$;

revoke all on function public.close_change_request(uuid, text, jsonb, jsonb) from anon, public;
grant execute on function public.close_change_request(uuid, text, jsonb, jsonb) to authenticated;