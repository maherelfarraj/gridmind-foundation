alter table public.project_yield_config
  add column if not exists contract_pr numeric(6,3);
comment on column public.project_yield_config.contract_pr is 'Contracted Performance Ratio (percent, 0–100), used to prefill PR test forms.';