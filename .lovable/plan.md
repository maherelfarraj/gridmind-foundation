## P-051 — Documents & drawing register migration

Create `supabase/migrations/0017_documents_drawings.sql`, applied via the migration tool. Idempotent, tenant-scoped, RLS-first.

### Enums (guarded do-blocks — re-runnable)
- `document_category`: drawing, report, calculation, datasheet, correspondence, contract_doc, other
- `drawing_status`: draft, IFD, IFC, as_built, superseded
- `drawing_discipline`: civil, structural, electrical, mechanical, scada_controls, survey, general

### Tables (all with `id`, `company_id`, `created_at`, `updated_at`, `created_by` where noted)
1. `public.documents` — project docs registry (path in `documents` or `drawings` bucket), `category`, `tags[]`.
2. `public.drawing_register` — per-project drawing headers, `unique(project_id, drawing_number)`, `current_revision_id` (deferred FK added after `drawing_revisions`), `locked bool` (flipped at IFC).
3. `public.drawing_revisions` — versioned files in `drawings` bucket, `unique(drawing_id, revision_code)`, `status`, `issue_reason`, `issued_by/at`.
4. `public.document_markups` — reviewer annotations on a revision, `annotation jsonb`, `status` check-in (open/accepted/rejected/resolved), `reviewer_org` free-text tag.

### Indexes
`documents(project_id)`, `drawing_register(project_id, discipline)`, `drawing_revisions(drawing_id)`, `document_markups(revision_id, status)`.

### GRANTs (before RLS enable)
`GRANT SELECT, INSERT, UPDATE ON public.<table> TO authenticated;` and `GRANT ALL TO service_role;` on all four. No DELETE grant — deletes go through admin-only paths later.

### RLS (all 4 tables)
- **SELECT**: `is_company_member(company_id)`.
- **`documents` + `drawing_register` INSERT/UPDATE**: `has_role(auth.uid(),'engineering_admin' | 'engineer' | 'project_admin')` AND `is_company_member(company_id)`.
- **`drawing_revisions`**: INSERT = same three roles; UPDATE restricted to `engineering_admin` or `project_admin`.
- **`document_markups`**:
  - INSERT: `is_company_member(company_id)` OR `has_role(auth.uid(),'client_viewer' | 'lender_viewer')` (external reviewers can annotate but not touch the register).
  - UPDATE: `reviewer_id = auth.uid()` OR `has_role(auth.uid(),'engineering_admin')`.

### Triggers
- `set_updated_at()` BEFORE UPDATE on all 4 tables (reused from 0010).
- New AFTER UPDATE trigger on `drawing_revisions`: when `status IS DISTINCT FROM old.status`, call `public.write_audit_log('drawing_revision.status_changed','drawing_revisions', new.id, jsonb_build_object('from', old.status, 'to', new.status))`. Function is SECURITY DEFINER, `set search_path = public`.

### Ordering (single migration, one transaction)
1. Enums (guarded).
2. Create `documents`, `drawing_register`, `drawing_revisions`, `document_markups`.
3. `ALTER TABLE drawing_register ADD CONSTRAINT fk_current_revision …` after `drawing_revisions` exists.
4. Indexes.
5. GRANTs.
6. `ENABLE ROW LEVEL SECURITY` on each.
7. Policies.
8. `set_updated_at` triggers + audit trigger + trigger function.

### Post-apply verification (via `supabase--read_query`)
- Enums present: `pg_type` lookup for all 3.
- All 4 tables show `rowsecurity = true` in `pg_tables`.
- Column dump per table (name, type, nullability).
- Unique constraint check: attempt duplicate `(project_id, drawing_number)` insert (rolled back) — expect violation.
- Confirm `drawing_revisions_status_audit` trigger exists in `pg_trigger`.

### Not in this step (called out for clarity)
- No seed data.
- No `drawings` bucket creation (already exists per project storage list).
- No UI/server functions — the checks in the ticket about client_viewer INSERT, cross-tenant SELECT, and audit-row emission are runtime scenarios that will be exercised in follow-up work; the migration only puts the policies and trigger in place.
