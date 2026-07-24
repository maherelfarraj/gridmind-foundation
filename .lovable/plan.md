# P-028 — Permission Simulator

Read-only preview tool at `/settings/permissions-simulator` for company admins and super admins to answer "what can role X see and do?" — no mutations, no audit writes.

## Extend `src/lib/permissions.ts`

Add two typed constants alongside `ROLE_TO_MODULES` (which today only covers 5 roles — the new maps cover all `GrantableRole` values, i.e. every `app_role` except `super_admin`, grouped by `ROLE_GROUPS` from `role-groups.ts`):

- `ROLE_MODULE_MAP: Record<GrantableRole, ModuleKey[]>` — full per-role module visibility. Department admins get their own department's module plus related read modules; operational roles get their working modules; external viewers get portal + read-only relevant modules; `company_admin` / `billing_admin` / `project_admin` get all core modules + `admin`.
- `ROLE_ACTION_MATRIX: Record<GrantableRole, Partial<Record<ModuleKey, Set<Action>>>>` where `Action = "view" | "create" | "edit" | "approve" | "export"`. Rules:
  - `client_viewer` / `investor_viewer` / `lender_viewer` — `view` only, on their visible modules.
  - Operational roles — `view` + `create` + `edit` on their modules; no `approve`.
  - Department admins — full set (`view`/`create`/`edit`/`approve`/`export`) on their own department's module, `view` on peer modules.
  - `company_admin`, `billing_admin`, `project_admin` — full set on all modules they see.

Also export helper `getActionsFor(role, moduleKey): Set<Action>`.

## New route `src/routes/_authenticated/settings.permissions-simulator.tsx`

Layout: two-column responsive grid (stacks on mobile).

**Left panel (`bg-card border-border` card):**
- Header: "Permission simulator" + muted explainer "Preview only — actual access is enforced by RLS and `has_role()` on every request."
- Primary role `Select` grouped by `ROLE_GROUPS` (Administration / Department admins / Operational / External viewers), `super_admin` excluded.
- "Compare with" toggle → shows a second `Select` with the same options plus a "Clear" button.
- Header chips: selected role badge(s) + active tenant plan tier badge (from `listModuleAccess` response, which already returns `planTier`).

**Right panel — three stacked cards, all recompute on selection:**

1. **Visible modules** — for each `ModuleKey` in `MODULE_REGISTRY`, show label (correct spelling from registry: "O&M & SCADA", "Green H₂", "Field, HSE & QA/QC"):
   - Role has it AND tenant rule enabled → check icon + label.
   - Role has it AND tenant rule disabled → check + "off by plan" muted suffix (not hidden).
   - Role doesn't have it → dash icon, muted label.
   - Compare mode: two columns per module.

2. **Visible routes** — tree derived from the sidebar `NAV_SECTIONS` map (extract to `src/lib/nav-map.ts` shared by `AppSidebar` and the simulator so they can't drift). Group by section header; render `/route/path` in mono. Filter by same rule as sidebar (module in role map AND enabled in tenant rules; `admin` items require `company_admin`/`billing_admin`/`project_admin`). Compare mode = side-by-side.

3. **Allowed actions** — table with rows = modules the role can see, columns = View / Create / Edit / Approve / Export. Cells = check or em-dash from `ROLE_ACTION_MATRIX`. Compare mode = two stacked tables labelled by role, or a merged table with two icon columns per action (pick stacked — cleaner).

**States:**
- No role selected → empty state prompting "Pick a role to preview its access."
- `modulesQuery.isLoading` → skeleton rows in all three cards.
- `modulesQuery.error` → error state with retry.

**Data:**
- `listModuleAccess({ data: { companyId: activeCompanyId } })` — reuses the existing RPC; zero writes.
- `useActiveCompany()` for the tenant.
- No new server function.

**Access gate:** loader/component queries `getCurrentUserRoles`; if user is not `company_admin` / `super_admin` in the active company, render an "Access denied" card (server-side enforcement is unchanged — this is a UI-only tool with no mutations, so it can't leak anything).

## Nav

Add "Permissions simulator" entry to `AppSidebar`'s Administration section (`admin` module, `Eye` icon, url `/settings/permissions-simulator`).

## Route metadata

`head()` — title "Permissions simulator · GridMind EPC", description "Preview which modules, routes, and actions a role can access on this tenant.", `robots: noindex` (admin tool). No OG image.

## Technical details

- Design tokens only: `bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`, `text-foreground`. No raw hex, no arbitrary colors. Check/dash icons via `lucide-react` (`Check`, `Minus`).
- `humanizeRole()` from `role-groups.ts` for role display labels.
- Extract `NAV_SECTIONS` from `app-sidebar.tsx` into `src/lib/nav-map.ts` and re-import from both places — prevents drift.
- Compile-time exhaustiveness check on `ROLE_MODULE_MAP` keys against `GrantableRole` (same pattern as `_ExhaustiveCheck` in `role-groups.ts`).
- No `createServerFn` needed; zero writes means zero audit rows by construction.
