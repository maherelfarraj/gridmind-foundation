create or replace function public.transmittal_items_freeze()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status public.transmittal_status;
  v_found boolean;
begin
  select t.status, true into v_status, v_found
    from public.transmittals t
   where t.id = coalesce(new.transmittal_id, old.transmittal_id);

  -- The parent transmittal is gone: this row is part of that cascade, so the
  -- freeze does not apply (deleting a DRAFT transmittal must stay possible).
  if tg_op = 'DELETE' and not coalesce(v_found, false) then
    return old;
  end if;

  if v_status is distinct from 'draft'::public.transmittal_status then
    raise exception 'transmittal_items_frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;