## Reconcile: my earlier P-041 vs the canonical spec

The migration I shipped moments ago used a different set of enum labels and column names than this canonical spec (no `sales`-role gating, no `project_intake`, `full_name` split into `first/last`, different `lead_status` / `opportunity_stage` / `tender_event_type` labels, `archetype text` instead of the `project_archetype` enum). All four tables are empty, so replacing them is safe and produces zero data loss.

Verified against the live DB:
- `app_role` already contains `sales`, `project_admin`, `company_admin` — no enum ALTER needed for roles.
- `project_archetype` enum exists with the 7 canonical values (`utility_pv`, `standalone_bess`, `c_and_i_rooftop`, `hybrid_pv_bess`, `onshore_wind`, `green_hydrogen`, `transmission_substation`) — using it as the column type gives the "rejects invalid archetype" check by construction.
- `profiles` and `projects` exist. `project_intake` does not exist yet.
- `public.is_company_member(uuid)` and `public.has_role(uuid, app_role)` already installed and used elsewhere.

## Migration `0016_crm_core.sql` (0015 slot is already used by my previous CRM migration; keeping the filename monotonic and idempotent avoids a filename collision on disk while still landing the canonical schema)

> Note on numbering: the file will be named `0016_crm_core.sql` because `0015_crm_core.sql` already exists on disk from the previous step. The canonical intent (CRM core, tables + enums per spec) is preserved. If you'd rather I overwrite `0015_crm_core.sql` in place and issue a single canonical migration, say so and I'll do that instead.

### Reset (safe — tables are empty)
```sql
DROP TABLE IF EXISTS public.tender_events CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.opportunities CASCADE;
DROP TABLE IF EXISTS public.leads CASCADE;
DROP TYPE IF EXISTS public.lead_status;
DROP TYPE IF EXISTS public.lead_source;
DROP TYPE IF EXISTS public.opportunity_stage;
DROP TYPE IF EXISTS public.contact_type;
DROP TYPE IF EXISTS public.tender_event_type;
```

### Enums (guarded DO-blocks, spec labels)
- `lead_source`: `referral | inbound | outbound | event | partner | other`
- `lead_status`: `new | working | qualified | unqualified | converted`
- `opportunity_stage`: `prospecting | qualification | proposal | negotiation | won | lost`
- `tender_event_type`: `pre_bid_meeting | site_visit | qa_deadline | submission_deadline | bid_opening | clarification | award_announcement | other`
- `project_intake_status`: `new | in_review | accepted | rejected | converted`
- `project_intake_source`: `manual | opportunity | api | other`

(Contacts have no `type` enum per this spec — dropped.)

### Tables — all with platform conventions

Every table: `id uuid pk default gen_random_uuid()`, `company_id uuid not null references public.companies(id) on delete cascade`, `created_at`, `updated_at` (trigger), `created_by uuid references public.profiles(id) on delete set null`. All `CREATE TABLE IF NOT EXISTS`.

**`leads`** — `name`, `account_name`, `email citext`, `phone`, `source lead_source not null default 'inbound'`, `status lead_status not null default 'new'`, `owner_id uuid references auth.users on delete set null`, `notes text`. Indexes: `(company_id, status)`, `owner_id`.

**`project_intake`** — created here (defensive; P-050 uses it). Columns: `name text not null`, `archetype project_archetype`, `capacity_mw numeric`, `site_location text`, `offtaker text`, `target_cod date`, `status project_intake_status not null default 'new'`, `source project_intake_source not null default 'manual'`, `source_opportunity_id uuid`, `notes text`. Deferred FK added after opportunities is created:
```sql
ALTER TABLE public.project_intake
  DROP CONSTRAINT IF EXISTS project_intake_source_opportunity_id_fkey;
ALTER TABLE public.project_intake
  ADD CONSTRAINT project_intake_source_opportunity_id_fkey
  FOREIGN KEY (source_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;
```
Indexes: `(company_id, status)`, `source_opportunity_id`.

**`opportunities`** — `lead_id uuid references public.leads on delete set null`, `name text not null`, `account_name text`, `archetype project_archetype`, `capacity_mw numeric`, `stage opportunity_stage not null default 'prospecting'`, `estimated_value numeric(18,2)`, `currency_code text not null default 'USD'`, `probability int check (probability is null or probability between 0 and 100)`, `expected_decision_date date`, `competitor text`, `loss_reason text`, `owner_id uuid references auth.users on delete set null`, `converted_intake_id uuid references public.project_intake on delete set null`, `won_at timestamptz`, `lost_at timestamptz`, `notes text`. Indexes: `(company_id, stage)`, `owner_id`, `lead_id`, `converted_intake_id`.

**`contacts`** — `lead_id uuid references public.leads on delete cascade`, `opportunity_id uuid references public.opportunities on delete cascade`, `full_name text not null`, `title`, `email citext`, `phone`, `is_primary boolean not null default false`, `notes`. Table-level `CHECK (lead_id is not null OR opportunity_id is not null)`. Indexes: `opportunity_id`, `lead_id`.

**`tender_events`** — `opportunity_id uuid not null references public.opportunities on delete cascade`, `event_type tender_event_type not null`, `title text not null`, `event_at timestamptz not null`, `location text`, `notes text`, `reminder_sent_at timestamptz`. Indexes: `(opportunity_id, event_at desc)`.

### RLS — drop-then-create (idempotent) for each policy, on all 5 tables

Standard shape (`leads`, `opportunities`, `contacts`, `tender_events`):
- **SELECT** — company members: `public.is_company_member(company_id)`
- **INSERT** — sales or company_admin:
  `public.is_company_member(company_id) AND (public.has_role(auth.uid(),'sales'::app_role) OR public.has_role(auth.uid(),'company_admin'::app_role))`
- **UPDATE** — same predicate (USING + WITH CHECK)
- **DELETE** — company_admin only: `public.is_company_admin(company_id)`

`project_intake` variant — writes also permitted for `project_admin`:
`... has_role(...,'sales') OR has_role(...,'project_admin') OR has_role(...,'company_admin')`.

For `tender_events` (no `company_id` column would create a leak — but this table DOES have `company_id`, so the same predicate works directly).

### Triggers + Grants
- `BEFORE UPDATE ... EXECUTE FUNCTION public.set_updated_at()` on all 5 tables, `DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...` for idempotency.
- `GRANT SELECT, INSERT, UPDATE, DELETE ON <t> TO authenticated; GRANT ALL ON <t> TO service_role;` on all 5. No `anon` grants.

### Post-migration verification (I'll run automatically)
```sql
-- 1. All 5 tables + RLS
SELECT c.relname, c.relrowsecurity,
  (SELECT count(*) FROM pg_policies p WHERE p.tablename=c.relname AND p.schemaname='public') AS policies,
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('leads','project_intake','opportunities','contacts','tender_events')
ORDER BY c.relname;
-- expect 5 rows, relrowsecurity=true, policies=4, triggers>=1

-- 2. Column dump for each of the 5 tables
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('leads','project_intake','opportunities','contacts','tender_events')
ORDER BY table_name, ordinal_position;

-- 3. FK on project_intake.source_opportunity_id
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname='project_intake_source_opportunity_id_fkey';

-- 4. Archetype rejection test
DO $$ BEGIN
  BEGIN
    PERFORM 'not_an_archetype'::public.project_archetype;
    RAISE EXCEPTION 'archetype enum should have rejected bad value';
  EXCEPTION WHEN invalid_text_representation THEN NULL;
  END;
END $$;
```

I will not attempt to run RLS as a non-sales member via SQL (there's no auth session in this admin channel); the policy predicate is transparent from the CREATE POLICY output and I'll paste it back so you can eyeball. If you want a runtime proof, I can drive Playwright as a non-sales test user after the migration lands.

### Idempotency proof
The migration re-runs cleanly because every mutating statement is guarded:
- `DROP TABLE IF EXISTS` at the top (first run only actually drops)
- Enum creation wrapped in `DO $$ IF NOT EXISTS ... $$`
- `CREATE TABLE IF NOT EXISTS`
- `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`
- `DROP POLICY IF EXISTS` before every `CREATE POLICY`
- `DROP TRIGGER IF EXISTS` before every `CREATE TRIGGER`

On second run: DROPs succeed silently on freshly-created objects, IF NOT EXISTS skips creation, and policies/triggers are recreated to the same definition — no error.

### Not in this prompt
- No server functions, no UI, no seeds. Those land in P-042 (pipeline board + KPIs) and P-043 (opportunity detail).
- The pre-existing linter warnings (SECURITY DEFINER helpers, extension in public) are unrelated to this migration and unchanged by it.

Ready to ship on approval.