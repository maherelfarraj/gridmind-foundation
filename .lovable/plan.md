# P-027 — Module access admin

Build the tenant-scoped module access admin on top of migration 0005 (`module_access_rules` + `has_module_access`). Super admin edits any tenant; company admin reads their own; sidebar visibility follows the same rules (single source of truth).

## 1. Canonical module registry — `src/lib/modules.ts` (new)

Single source of truth for the 9 module keys from migration 0005's CHECK constraint:

| key | label | description | plans |
| --- | --- | --- | --- |
| `crm` | CRM & Origination | Leads, opportunities, proposals | starter, growth, enterprise |
| `engineering` | Engineering | Designs, drawings, BOM | starter, growth, enterprise |
| `procurement` | Procurement | Vendors, RFQs, POs, receipts | starter, growth, enterprise |
| `planning_budget` | Planning & Budget | Schedules, budgets, EVM | starter, growth, enterprise |
| `field_qaqc` | Field, HSE & QA/QC | Daily reports, inspections, incidents | growth, enterprise |
| `commissioning` | Commissioning | Punch lists, energization, handover | growth, enterprise |
| `portals` | Client & Investor Portals | External stakeholder access | growth, enterprise |
| `om_scada` | O&M & SCADA | Work orders, telemetry, alarms | enterprise |
| `green_hydrogen` | Green H₂ | Electrolyser + H₂ plant modules | **enterprise only** |

Exports: `MODULE_KEYS` (readonly tuple), `ModuleKey` type, `MODULE_REGISTRY` (label, description, `baselinePlans: PlanTier[]`, `enterpriseOnly: boolean`), helper `planAllowsModule(plan, key)` mirroring `has_module_access` baseline.

## 2. Reconcile `src/lib/permissions.ts`

The existing `ModuleKey` union uses obsolete keys (`planning`, `field`, `om`, `partners`). Re-export `ModuleKey` from `modules.ts` and rewrite `ROLE_TO_MODULES` / `MODULE_PLAN_REQUIREMENTS` / `getVisibleModules` to use the canonical 9 keys plus `admin`. Update `src/components/app-sidebar.tsx` nav items to the new keys (planning→planning_budget, field→field_qaqc, om→om_scada, partners→portals).

## 3. Server functions — `src/lib/modules.functions.ts` (new)

All zod-validated, all `attachSupabaseAuth` + `requireSupabaseAuth`, all audit-logged.

- `listModuleAccess({ companyId })` → `{ planTier, canEdit, modules: { key, enabled, source: 'override'|'baseline', allowedByPlan }[] }`. Any authenticated caller who is either super_admin OR company_admin/member of the tenant. Reads `companies.plan_tier`, joins `module_access_rules` for overrides, and for each of the 9 keys resolves final `enabled` the same way `has_module_access` does (override wins; green_hydrogen forced false unless enterprise). `canEdit` = super_admin.
- `setModuleAccess({ companyId, module, enabled })` → super_admin only (via `has_role`). Validates `module` against `MODULE_KEYS`. Rejects with **403 JSON** `{ error: 'plan_gated' }` if `enabled=true` and plan doesn't allow it (esp. green_hydrogen on non-enterprise). Upserts into `module_access_rules` on `(company_id, module)`. Writes `audit_logs` action `module_access.changed` with metadata `{ module_key, enabled, company_id, actor }`.
- Extend `updateTenantPlan` in `src/lib/tenants.functions.ts`: when a downgrade removes `green_hydrogen` (any → non-enterprise), upsert `module_access_rules` row `{ enabled: false }` for `green_hydrogen` and write `audit_logs` action `module_access.auto_disabled` with `{ from, to, module_key: 'green_hydrogen' }`. Done in the same handler after the plan update succeeds.

## 4. Shared UI — `src/components/module-access-table.tsx` (new)

Props: `{ companyId, planTier, canEdit, rows }`. Renders a table with columns: Module (label + description), Plan availability (three badges Starter/Growth/Enterprise; the ones that include the module are filled, others muted), Enabled (Switch, or read-only checkmark when `!canEdit`). Green H₂ switch is `disabled` on non-enterprise tenants with a shadcn Tooltip: *"Green H₂ requires the Enterprise plan — upgrade to enable."* Uses `useMutation` on `setModuleAccess` with optimistic update and sonner toasts; on 403 rolls back and toasts the server message. Skeleton row state; error card with Retry.

## 5. Routes

- `src/routes/_authenticated/admin.tenants.$companyId.tsx`: wrap the current body in shadcn `Tabs` — **Overview** (existing plan tier + stat cards) and **Modules** (`<ModuleAccessTable canEdit />`). Invalidate `['modules', companyId]` after `updateTenantPlan` succeeds so the Modules tab reflects auto-disable.
- `src/routes/_authenticated/settings.modules.tsx` (new): read-only `<ModuleAccessTable canEdit={false} />` for the active company (from `useActiveCompany`). Standard `head()` meta. Add sidebar nav item under Administration → "Module access" (visible to company_admin and above via existing gating).

## 6. Sidebar becomes rule-driven

`src/components/app-sidebar.tsx` currently derives visibility from `getVisibleModules` (role+plan only). Add a `useQuery(['modules', activeCompanyId], listModuleAccess)` and filter module-scoped nav items by `rows.find(r => r.key === item.moduleKey)?.enabled`. Admin section unaffected. Nav shows skeletons while loading; on error falls back to the plan-based visibility so nav isn't blank.

## 7. Verification (after build)

- 9 rows render on Demo EPC Co (enterprise) — all enabled.
- On a starter/growth tenant, Green H₂ switch is disabled + tooltip; `invoke-server-function` `setModuleAccess enabled=true` → 403 `plan_gated`.
- Toggle a module off on the active tenant → sidebar item disappears after query invalidation.
- Downgrade Demo EPC Co enterprise → growth → `module_access_rules` shows green_hydrogen enabled=false + one `module_access.auto_disabled` audit row.
- `/settings/modules` as company_admin: switches rendered read-only (disabled).
- Each toggle emits one `module_access.changed` audit row.

## Technical notes

- `module_access_rules` grants already in place from P-013; no migration required.
- Roles read via `has_role`/`has_company_role`; never from `profiles`.
- All strings use design tokens; badges use existing `Badge` variants.
- Zod enum uses `MODULE_KEYS` tuple so server input matches the CHECK constraint exactly.
