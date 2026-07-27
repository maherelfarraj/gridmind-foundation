-- P-211 — margin bounds + priced timestamp on estimates
alter table public.estimates
  add column if not exists priced_at timestamptz;

alter table public.estimates
  drop constraint if exists estimates_escalation_pct_range,
  drop constraint if exists estimates_contingency_pct_range,
  drop constraint if exists estimates_overhead_pct_range,
  drop constraint if exists estimates_profit_pct_range;

alter table public.estimates
  add constraint estimates_escalation_pct_range check (escalation_pct >= 0 and escalation_pct <= 50),
  add constraint estimates_contingency_pct_range check (contingency_pct >= 0 and contingency_pct <= 50),
  add constraint estimates_overhead_pct_range check (overhead_pct >= 0 and overhead_pct <= 50),
  add constraint estimates_profit_pct_range check (profit_pct >= 0 and profit_pct <= 50);