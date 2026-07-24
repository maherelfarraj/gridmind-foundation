# P-054 — Verification pass

P-054 was implemented in the previous turn. Rather than re-building, this plan verifies each acceptance check against the code and database that already exist, then reports results.

## Scope

No new features. Read-only verification + a single follow-up fix cycle if any check fails.

## Steps

1. **Schema check** — query `information_schema.columns` for `public.project_sld_config` and confirm `voltage_levels jsonb`, `bus_config text`, `metering_points jsonb`, `protection_scheme text`, `notes text` are present with the expected defaults; confirm the `updated_at` trigger is still attached and RLS policies unchanged.
2. **File inventory** — read `src/lib/sld.functions.ts`, `src/lib/sld-query.ts`, `src/components/engineering/SldConfigForm.tsx`, `SldHierarchyPreview.tsx`, `SldGallery.tsx`, and `src/routes/_authenticated/projects.$projectId.engineering.sld.tsx` to confirm:
   - `saveSldConfig` uses `requireSupabaseAuth`, zod validation (kV > 0 and ≤ 500, ≥1 voltage level), role gate (`engineering_admin | engineer | project_admin`), and writes an `engineering.sld_config_saved` audit row with a diff of changed fields.
   - Gallery filters drawings by the `SLD-` drawing-number prefix (documented deviation from the "tags contain SLD" spec because `drawing_register` has no `tags` column) and renders drawing number, revision, status badge, and markup count.
   - "New SLD" creates a `drawing_register` row pre-tagged as SLD and opens the P-053 upload flow.
   - Hierarchy preview sorts voltage levels ascending and renders `"33 kV collection → 132 kV export"`.
3. **Runtime check** — drive the preview with Playwright as an engineering user: open a project's Engineering → SLD tab, submit the Configuration form with zero voltage levels (expect inline zod error), then submit `33 kV collection + 132 kV export` (expect success toast + hierarchy preview). Query `audit_logs` for the resulting `engineering.sld_config_saved` row and confirm `metadata` contains the changed fields. Create a new SLD from the Gallery tab and confirm it appears with badges and opens the P-053 detail route. Repeat the read as a non-engineering role to confirm the form is read-only.
4. **Report** — summarise pass/fail per checklist item; if any fail, propose a minimal follow-up plan before touching code.

## Technical notes

- Deviation to flag explicitly to the user: SLD identification uses the `SLD-` drawing-number prefix, not a `tags` column, because `drawing_register` has no `tags` column in the current schema. If the user wants true tag-based filtering, that requires a schema change and should be a separate ticket.
- No migrations, no dependency installs, no route additions expected in this pass.

## Next

On green, message: `next → P-055 (engineering calculators — cable, transformer, string sizing + unit tests)`.
