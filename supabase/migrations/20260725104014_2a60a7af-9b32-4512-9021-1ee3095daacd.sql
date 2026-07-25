
-- P-099: Realign the Handover phase-gate checklist so the P-040 engine
-- gates on the CCC transfer, the turnover pack, and the Category A punch list.
-- Preserves any existing `done`/`done_by`/`done_at` state for matching keys.

with target as (
  select id, coalesce(checklist, '[]'::jsonb) as prior
  from public.project_phase_gates
  where phase = 'handover'
), merged as (
  select
    t.id,
    jsonb_build_array(
      -- ccc_signed
      jsonb_build_object(
        'key', 'ccc_signed',
        'label', 'Care, Custody & Control certificate signed',
        'required', true,
        'done', coalesce((
          select (item->>'done')::boolean
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'ccc_signed'
          limit 1
        ), false),
        'done_by', (
          select item->>'done_by'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'ccc_signed'
          limit 1
        ),
        'done_at', (
          select item->>'done_at'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'ccc_signed'
          limit 1
        )
      ),
      -- turnover_delivered
      jsonb_build_object(
        'key', 'turnover_delivered',
        'label', 'Turnover pack delivered',
        'required', true,
        'done', coalesce((
          select (item->>'done')::boolean
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'turnover_delivered'
          limit 1
        ), false),
        'done_by', (
          select item->>'done_by'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'turnover_delivered'
          limit 1
        ),
        'done_at', (
          select item->>'done_at'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'turnover_delivered'
          limit 1
        )
      ),
      -- punch_list_closed (preserve legacy state under the same key)
      jsonb_build_object(
        'key', 'punch_list_closed',
        'label', 'Category A punch list closed',
        'required', true,
        'done', coalesce((
          select (item->>'done')::boolean
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'punch_list_closed'
          limit 1
        ), false),
        'done_by', (
          select item->>'done_by'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'punch_list_closed'
          limit 1
        ),
        'done_at', (
          select item->>'done_at'
          from jsonb_array_elements(t.prior) item
          where item->>'key' = 'punch_list_closed'
          limit 1
        )
      )
    ) as new_checklist
  from target t
)
update public.project_phase_gates g
   set checklist = m.new_checklist
  from merged m
 where g.id = m.id;
