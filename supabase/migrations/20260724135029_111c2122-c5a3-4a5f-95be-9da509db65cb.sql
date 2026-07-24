create or replace function public.proposals_enforce_pricing_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(old.pricing_lock->>'status','') = 'approved' and (
       new.margin_pct is distinct from old.margin_pct
       or new.fx_rate_snapshot is distinct from old.fx_rate_snapshot
       or new.contingency_pct is distinct from old.contingency_pct
       or new.subtotal is distinct from old.subtotal
       or new.total is distinct from old.total) then
    raise exception 'pricing locked by CFO approval — create a new version';
  end if;
  return new;
end $$;

drop trigger if exists trg_proposals_pricing_lock on public.proposals;
create trigger trg_proposals_pricing_lock before update on public.proposals
  for each row execute function public.proposals_enforce_pricing_lock();