create or replace function public.transmittals_guard_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- System/maintenance paths (no end user in the session) are exempt.
  if auth.uid() is null then
    return old;
  end if;
  if old.status is distinct from 'draft'::public.transmittal_status then
    raise exception 'transmittal_not_draft' using errcode = '42501';
  end if;
  return old;
end
$function$;