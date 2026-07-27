insert into public.esg_emission_factors
  (company_id, category, scope, unit, kg_co2e_per_unit, factor_code, factor_source, valid_from, notes)
values
  ('1ab0730f-d6fa-4678-b1b7-7f752c80eceb', 'electricity_grid', 'scope_2', 'kWh', 0.550000,
   'ELECTRICITY_GRID-JO-NEPCO', 'Jordan national grid (NEPCO) average grid emission factor', '1900-01-01',
   'Jordan-specific grid factor used for GSI site offices. Overrides the global IEA average of 0.45 kg CO2e/kWh.')
on conflict do nothing;