-- P-035: seed system project templates for Demo EPC Co.
-- Idempotent via ON CONFLICT (company_id, name, archetype).
WITH demo AS (
  SELECT id FROM public.companies WHERE name = 'Demo EPC Co.' LIMIT 1
)
INSERT INTO public.project_templates
  (company_id, name, archetype, description, is_system,
   default_gates, default_budget_lines, default_departments)
SELECT d.id, v.name, v.archetype::project_archetype, v.description, true,
       v.gates::jsonb, v.budget::jsonb, v.depts::project_department[]
FROM demo d
CROSS JOIN (VALUES
  (
    'Utility PV — Standard', 'utility_pv',
    'Grid-scale ground-mount PV: land, interconnection, financing, EPC, energisation, punch-list.',
    $$[
      {"phase":"development","name":"Land control secured","sort_order":1},
      {"phase":"development","name":"Interconnection queue position","sort_order":2},
      {"phase":"development","name":"Environmental permit issued","sort_order":3},
      {"phase":"ntp","name":"Financing close","sort_order":4},
      {"phase":"ntp","name":"EPC contract signed","sort_order":5},
      {"phase":"cod","name":"Mechanical completion","sort_order":6},
      {"phase":"cod","name":"Grid energisation","sort_order":7},
      {"phase":"handover","name":"Punch-list closed","sort_order":8}
    ]$$,
    $$[
      {"category":"EPC","code":"MOD","label":"Modules","share":0.30},
      {"category":"EPC","code":"INV","label":"Inverters","share":0.10},
      {"category":"EPC","code":"TRK","label":"Trackers & structure","share":0.15},
      {"category":"BOS","code":"BOS","label":"Balance of system","share":0.20},
      {"category":"EPC","code":"INS","label":"Installation & labour","share":0.15},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.05},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.05}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,scada}'
  ),
  (
    'Standalone BESS — Standard', 'standalone_bess',
    'Utility battery storage for grid services and arbitrage.',
    $$[
      {"phase":"development","name":"Land control secured","sort_order":1},
      {"phase":"development","name":"Interconnection queue position","sort_order":2},
      {"phase":"ntp","name":"Financing close","sort_order":3},
      {"phase":"ntp","name":"EPC contract signed","sort_order":4},
      {"phase":"cod","name":"Mechanical completion","sort_order":5},
      {"phase":"cod","name":"Grid energisation","sort_order":6},
      {"phase":"cod","name":"Augmentation plan approved","sort_order":7},
      {"phase":"handover","name":"Punch-list closed","sort_order":8}
    ]$$,
    $$[
      {"category":"EPC","code":"BAT","label":"Battery packs","share":0.45},
      {"category":"EPC","code":"PCS","label":"PCS & transformers","share":0.15},
      {"category":"EPC","code":"CTR","label":"Containers & HVAC","share":0.10},
      {"category":"BOS","code":"BOS","label":"Balance of system","share":0.15},
      {"category":"EPC","code":"INS","label":"Installation & labour","share":0.05},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.05},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.05}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,scada}'
  ),
  (
    'C&I Rooftop — Standard', 'c_and_i_rooftop',
    'Commercial & industrial rooftop PV installations.',
    $$[
      {"phase":"development","name":"Site survey complete","sort_order":1},
      {"phase":"development","name":"Roof structural sign-off","sort_order":2},
      {"phase":"ntp","name":"PPA signed","sort_order":3},
      {"phase":"cod","name":"Mechanical completion","sort_order":4},
      {"phase":"cod","name":"Utility inspection passed","sort_order":5},
      {"phase":"handover","name":"Handover to client","sort_order":6}
    ]$$,
    $$[
      {"category":"EPC","code":"MOD","label":"Modules","share":0.35},
      {"category":"EPC","code":"INV","label":"Inverters","share":0.15},
      {"category":"EPC","code":"MNT","label":"Mounting & structure","share":0.15},
      {"category":"EPC","code":"INS","label":"Installation & labour","share":0.20},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.08},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.07}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,billing}'
  ),
  (
    'Hybrid PV+BESS — Standard', 'hybrid_pv_bess',
    'Co-located solar and battery storage behind a single POI.',
    $$[
      {"phase":"development","name":"Land control secured","sort_order":1},
      {"phase":"development","name":"Interconnection queue position","sort_order":2},
      {"phase":"ntp","name":"Financing close","sort_order":3},
      {"phase":"ntp","name":"EPC contract signed","sort_order":4},
      {"phase":"cod","name":"PV energisation","sort_order":5},
      {"phase":"cod","name":"BESS energisation","sort_order":6},
      {"phase":"handover","name":"Punch-list closed","sort_order":7}
    ]$$,
    $$[
      {"category":"EPC","code":"MOD","label":"Modules","share":0.22},
      {"category":"EPC","code":"BAT","label":"Battery packs","share":0.25},
      {"category":"EPC","code":"INV","label":"Inverters & PCS","share":0.13},
      {"category":"EPC","code":"STR","label":"Trackers & structure","share":0.10},
      {"category":"BOS","code":"BOS","label":"Balance of system","share":0.15},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.08},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.07}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,scada}'
  ),
  (
    'Onshore Wind — Standard', 'onshore_wind',
    'Onshore wind farms with turbine, foundation, and collection design.',
    $$[
      {"phase":"development","name":"Wind resource assessment","sort_order":1},
      {"phase":"development","name":"Land control secured","sort_order":2},
      {"phase":"development","name":"Interconnection queue position","sort_order":3},
      {"phase":"ntp","name":"Financing close","sort_order":4},
      {"phase":"ntp","name":"Turbine supply agreement","sort_order":5},
      {"phase":"cod","name":"Turbine erection complete","sort_order":6},
      {"phase":"cod","name":"Grid energisation","sort_order":7},
      {"phase":"handover","name":"Punch-list closed","sort_order":8}
    ]$$,
    $$[
      {"category":"EPC","code":"WTG","label":"Turbines","share":0.55},
      {"category":"EPC","code":"FND","label":"Foundations & civils","share":0.12},
      {"category":"EPC","code":"COL","label":"Collection system","share":0.10},
      {"category":"BOS","code":"BOS","label":"Balance of system","share":0.10},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.07},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.06}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,scada}'
  ),
  (
    'Green H₂ — Standard', 'green_hydrogen',
    'Renewable-powered electrolysis and hydrogen offtake.',
    $$[
      {"phase":"development","name":"Feedstock power secured","sort_order":1},
      {"phase":"development","name":"Water source & permit","sort_order":2},
      {"phase":"ntp","name":"Financing close","sort_order":3},
      {"phase":"ntp","name":"Offtake certification","sort_order":4},
      {"phase":"cod","name":"Electrolyser commissioning","sort_order":5},
      {"phase":"cod","name":"First hydrogen produced","sort_order":6},
      {"phase":"handover","name":"Punch-list closed","sort_order":7}
    ]$$,
    $$[
      {"category":"EPC","code":"ELY","label":"Electrolyser stack","share":0.40},
      {"category":"EPC","code":"BOP","label":"Balance of plant","share":0.20},
      {"category":"EPC","code":"CMP","label":"Compression & storage","share":0.15},
      {"category":"EPC","code":"INS","label":"EPC install","share":0.13},
      {"category":"DEV","code":"DEV","label":"Development & permitting","share":0.07},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.05}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,om,scada}'
  ),
  (
    'Transmission Substation — Standard', 'transmission_substation',
    'HV/EHV substations, switchyards, and interconnection scopes.',
    $$[
      {"phase":"development","name":"Site & easement secured","sort_order":1},
      {"phase":"development","name":"Utility studies complete","sort_order":2},
      {"phase":"ntp","name":"Primary equipment ordered","sort_order":3},
      {"phase":"cod","name":"Mechanical completion","sort_order":4},
      {"phase":"cod","name":"SCADA integration test","sort_order":5},
      {"phase":"cod","name":"Grid energisation","sort_order":6},
      {"phase":"handover","name":"Punch-list closed","sort_order":7}
    ]$$,
    $$[
      {"category":"EPC","code":"PRM","label":"Primary equipment","share":0.45},
      {"category":"EPC","code":"P&C","label":"Protection & control","share":0.15},
      {"category":"EPC","code":"CIV","label":"Civils & structures","share":0.15},
      {"category":"EPC","code":"ENG","label":"Engineering","share":0.15},
      {"category":"OWN","code":"CON","label":"Owner contingency","share":0.10}
    ]$$,
    '{engineering,procurement,construction,hse,finance,legal,scada}'
  )
) AS v(name, archetype, description, gates, budget, depts)
ON CONFLICT (company_id, name, archetype) DO NOTHING;