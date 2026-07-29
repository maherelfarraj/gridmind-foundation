create or replace function public.transmittals_guard_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status is distinct from 'draft'::public.transmittal_status then
    raise exception 'transmittal_not_draft' using errcode = '42501';
  end if;
  return old;
end
$function$;

drop trigger if exists transmittals_guard_delete_trg on public.transmittals;
create trigger transmittals_guard_delete_trg
before delete on public.transmittals
for each row execute function public.transmittals_guard_delete();