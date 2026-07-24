# P-026 — Department Configuration Page

Adds `/settings/departments` for company_admin (super_admin allowed) with 9 fixed department cards, each showing responsibilities, current admin chips, and an "Assign admin" flow that reuses the guarded `grantRole` / `revokeRole` RPCs from P-024. No new tables, no new server functions.

## 1. Single source of truth: `src/lib/permissions.ts`

Append (keep all existing exports untouched):

```ts
import type { GrantableRole } from "./role-groups";

export type DepartmentKey =
  | "engineering" | "procurement" | "construction" | "hse"
  | "finance" | "legal" | "om" | "scada" | "billing";

export interface Department {
  key: DepartmentKey;
  name: string;              // display label ("O&M", "HSE" spelled exactly)
  adminRole: GrantableRole;  // corresponding app_role in user_roles
  responsibilities: string;  // Tenant Manual copy
  icon: LucideIcon;          // lucide-react component
}

export const DEPARTMENTS: readonly Department[] = [ /* 9 entries */ ];
```

Icons (lucide-react): `Ruler` (engineering), `ShoppingCart` (procurement), `HardHat` (construction), `ShieldAlert` (hse), `Wallet` (finance), `Scale` (legal), `Wrench` (om), `Activity` (scada), `Receipt` (billing).

Responsibilities strings copied verbatim from the request (checked against Tenant Manual wording).

Compile-time exhaustiveness check so any new `DepartmentKey` must be added to `DEPARTMENTS`.

## 2. Route: `src/routes/_authenticated/settings.departments.tsx`

- `createFileRoute("/_authenticated/settings/departments")` with `head()` (title "Departments — GridMind EPC", matching description + og tags).
- Uses `useActiveCompany()`, `useServerFn(listCompanyMembers)`, `useServerFn(grantRole)`, `useServerFn(revokeRole)`.
- One `useQuery` on `["company-members", activeCompanyId]` (same key as P-024 so caches stay in sync).
- Derives `isAdmin` from the query result; if not admin, page renders a read-only view (chips visible, no Assign button). Server-side `assert_can_grant_role` is the real gate.

### Layout
- Page header: `<h1>Departments</h1>` + subtitle.
- Responsive grid: `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`.
- One `<Card>` per `DEPARTMENTS` entry with:
  - Header: icon in a rounded token-colored square + `dept.name`.
  - Body: `dept.responsibilities` paragraph (`text-sm text-muted-foreground`).
  - Admins section: label "Admins" + chips (`Avatar` + name/email) for every member whose `roles` includes `dept.adminRole`; empty state "No admin assigned".
  - Footer: "Assign admin" button (opens picker for that department). Disabled with tooltip if `!isAdmin`.
- Loading: 9 skeleton cards. Error: card list replaced by an inline error state with retry.

### Assign-admin picker (shared dialog component in same file)
- shadcn `Dialog` with a `Command` search palette listing all company members not currently holding that department's admin role.
- Selecting a member calls `grantRole({ targetUserId, role: dept.adminRole })`; optimistic cache patch via `queryClient.setQueryData(["company-members", activeCompanyId], …)` — same pattern as `settings.users.tsx`.
- Current admin chip has an "x" button → `revokeRole({ targetUserId, role: dept.adminRole })` with confirm.
- Toasts on success/error; both branches write audit rows automatically (existing `grantRole` / `revokeRole` already call `write_audit_log` for `role.granted` / `role.revoked`).
- No last-admin guard needed (department admins aren't the tenant lockout risk); `revokeRole`'s existing safety on `company_admin` still stands.

## 3. Navigation

Add "Departments" entry to the Settings section of `src/components/app-sidebar.tsx` next to "Users" using the `Building2` icon.

## 4. Verification checks after build

- Route renders 9 cards labelled exactly: Engineering, Procurement, Construction, HSE, Finance, Legal, O&M, SCADA, Billing.
- Responsibilities strings match the Tenant Manual copy.
- Assigning `finance_admin` to a second user shows the chip immediately, inserts `user_roles` row, logs `role.granted`.
- Removing chip logs `role.revoked` and updates UI.
- Signed in as non-admin: Assign button disabled AND server-side call rejects with `assert_can_grant_role` error (toast).
- Typecheck (`bunx tsgo`) clean.

## Technical notes

- No new server functions, no migrations, no new tables — department admin state = `user_roles(user_id, company_id, role=<dept>_admin)`.
- `DEPARTMENTS` is the only place these 9 keys/roles/labels/copy live; sidebar and future module gating read from it.
- All styling via semantic tokens; icons via lucide-react components on `text-muted-foreground` / `text-foreground`.
- Reuses P-024's `grantRole`/`revokeRole` verbatim → audit + guard preserved.
