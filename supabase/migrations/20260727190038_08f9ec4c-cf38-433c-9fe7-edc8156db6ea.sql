create or replace function public.cwp_block_forward_on_hold_point()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  forward boolean := false;
begin
  if coalesce(new.progress_pct, 0) > coalesce(old.progress_pct, 0) then
    forward := true;
  end if;
  if new.status is distinct from old.status
     and new.status::text in ('in_progress', 'complete', 'completed', 'closed') then
    forward := true;
  end if;

  if forward then
    perform public.assert_no_open_hold_point(new.id);
  end if;

  return new;
end
$$;

drop trigger if exists trg_cwp_hold_point on public.construction_work_packages;
create trigger trg_cwp_hold_point
  before update on public.construction_work_packages
  for each row
  execute function public.cwp_block_forward_on_hold_point();