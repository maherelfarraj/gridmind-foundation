## Checkpoint sweep

**Schema (16/16 tables, all RLS on):** ✅
`projects, project_members, project_departments, project_phase_gates, project_templates, project_pv_config, project_bess_config, project_substation_config, project_sld_config, project_scada_config, project_yield_config, project_pvsyst_config, project_financial_config, project_cybersecurity_config, approval_instances, approvals`

**Audit trail:**
```
project.created   1
role.granted      2
```
No `gate.*` or `project_config.saved` rows yet — expected if you haven't walked the Prairie Winds gate/config flow in the UI. Do that walkthrough to satisfy the live-sweep boxes; the code paths are wired and audited.

Migrations 0012 / 0013 / 0013b / 0014 commit-to-GitHub is a manual step on your side.

---

## P-041 — CRM core migration (`0015_crm_core.sql`)

Single migration introducing the CRM domain. All tables tenant-scoped by `company_id`, RLS on, GRANTs to `authenticated` + `service_role`, `updated_at` trigger via existing `public.set_updated_at()`, standard audit hooks via existing `public.write_audit_log(...)` from server functions in later prompts (no triggers here — keeps this migration schema-only, matching Batch 04 pattern).

### Enums
- `lead_status`: `new | qualifying | qualified | disqualified | converted`
- `lead_source`: `inbound | outbound | referral | tender_portal | event | partner | other`
- `opportunity_stage`: `prospect | qualified | proposal | negotiation | won | lost`
- `contact_type`: `client | partner | consultant | epc_peer | authority | other`
- `tender_event_type`: `rfi | rfp | rfq | tender | prequal | site_visit | q_and_a | submission | award`

### Tables

**`leads`** — top-of-funnel, may or may not become an opportunity
- `company_id` (fk companies, cascade), `owner_id` (fk auth.users, set null)
- `name`, `organization`, `email` (citext), `phone`, `country`, `region`
- `source lead_source not null default 'inbound'`
- `status lead_status not null default 'new'`
- `estimated_capacity_mw numeric`, `archetype text` (matches archetype enum values as text — soft link, no fk)
- `notes text`
- indexes: `(company_id, status)`, `(company_id, owner_id)`

**`opportunities`** — qualified pursuits, pipeline board rows
- `company_id`, `owner_id`, `lead_id` (fk leads, set null)
- `name text not null`, `client_name text`, `archetype text`
- `stage opportunity_stage not null default 'prospect'`
- `value_amount numeric`, `value_currency text default 'USD'`
- `probability int check (probability between 0 and 100)`
- `expected_close_date date`, `actual_close_date date`
- `competitor text`, `loss_reason text`
- `converted_project_id uuid` (fk projects, set null — set by P-050 win flow)
- indexes: `(company_id, stage)`, `(company_id, owner_id)`, `(company_id, expected_close_date)`

**`contacts`** — people attached to leads / opportunities / tenders
- `company_id`, `type contact_type not null default 'client'`
- `first_name`, `last_name`, `title`, `email` (citext), `phone`, `organization`
- `lead_id` (fk leads, cascade, nullable)
- `opportunity_id` (fk opportunities, cascade, nullable)
- CHECK: at least one of `lead_id` / `opportunity_id` is set
- index: `(company_id, opportunity_id)`, `(company_id, lead_id)`

**`tender_events`** — timeline entries on an opportunity (RFI issued, site visit, submission, award, …)
- `company_id`, `opportunity_id` (fk opportunities, cascade, not null)
- `type tender_event_type not null`
- `event_date date not null`
- `title text not null`, `notes text`
- `created_by` (fk auth.users, set null)
- index: `(opportunity_id, event_date desc)`

### RLS policies (all tables, same shape)
- SELECT: `public.is_company_member(company_id)`
- INSERT: `public.is_company_member(company_id)` WITH CHECK
- UPDATE: `is_company_member(company_id)` (owner or company_admin gate enforced in RPCs later)
- DELETE: `public.is_company_admin(company_id)`

### GRANTs
`GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;`
`GRANT ALL ON public.<table> TO service_role;`
No `anon` grants — every policy scopes to `auth.uid()` via `is_company_member`.

### Triggers
`updated_at` maintained by `BEFORE UPDATE ... EXECUTE FUNCTION public.set_updated_at()` on all four tables.

### Post-migration verification (I'll run automatically)
- Confirm 4 new tables exist, `relrowsecurity = true` on each
- Confirm every table has ≥ 4 policies + `updated_at` trigger
- Confirm enums exist and GRANTs are in place
- Regenerate Supabase types (auto after approval)

No UI, no server functions, no seed data in this prompt — those land in P-042 (pipeline board) and P-043 (opportunity detail). Ready to submit the migration on your go.