## P-007 — AppShell (sidebar + header + shell chrome)

Mount an authenticated app shell around every route under `_authenticated/`, using shadcn/ui `sidebar` primitives and semantic design tokens only.

### Routing

- **Do not** create `src/routes/(app)/…` — TanStack uses `_authenticated/` (already integration-managed and present). Do not create `_authenticated/index.tsx` — `src/routes/index.tsx` already claims `/`.
- Edit `src/routes/_authenticated/route.tsx` to render `<AppShell><Outlet /></AppShell>` inside its component. `ssr: false` + `beforeLoad` auth gate are preserved verbatim.
- Rebuild `src/routes/_authenticated/dashboard.tsx` as the shell's demonstrable landing: header title "Dashboard", placeholder KPI cards, skeleton loading state, and a friendly empty state block. Sign-in flow already redirects there.

### New files

**`src/lib/permissions.ts`** — stub permission layer, real data lands in Batch 03.
- Types: `Role` (`viewer | member | manager | company_admin | super_admin`), `PlanTier` (`starter | growth | enterprise`), `ModuleKey` (one per nav item below).
- `ROLE_TO_MODULES: Record<Role, ModuleKey[]>` — permissive defaults per role; `company_admin` / `super_admin` get the Admin section.
- `MODULE_PLAN_REQUIREMENTS: Partial<Record<ModuleKey, PlanTier>>` — `green_hydrogen: 'enterprise'`.
- `getVisibleModules(role, planTier): Set<ModuleKey>` — intersects role modules with plan-tier gates.
- Exported dev default `DEV_SESSION_CONTEXT = { role: 'company_admin', planTier: 'enterprise' }` so every nav item is visible for now; wired into a real session context in Batch 03.

**`src/components/app-sidebar.tsx`** — shadcn `Sidebar collapsible="icon"`.
- Header: "GridMind EPC" wordmark in `font-display` (Space Grotesk); collapses to a monogram in icon mode.
- Groups (labels + lucide icons; each item declares its `ModuleKey`, hidden when `getVisibleModules(...)` omits it):
  - **Develop & Sell (CRM)** — `Handshake` → `/crm` (stub route path only, no leaf file yet)
  - **Engineering** — `PencilRuler` → `/engineering`
  - **Procurement** — `Truck` → `/procurement`
  - **Planning & Budget** — `CalendarRange` → `/planning`
  - **Build / Field** — `HardHat` → `/field`
  - **Commission & Turnover** — `ClipboardCheck` → `/commissioning`
  - **Operate O&M** — `Wrench` → `/om`
  - **Client & Partners** — `Users` → `/partners`
  - **Green H₂** *(plan-gated: enterprise)* — `Atom` → `/green-h2`
  - **Admin** *(role-gated: company_admin/super_admin)* — `Shield` → `/admin`
- Uses `<Link>` from `@tanstack/react-router` with `activeProps` for highlight; `useRouterState` picks the pathname for `isActive`.
- Nav items point at future routes that don't exist yet. To keep the type-safe router happy, render them as plain `<a href>` for now with a `TODO: swap to <Link>` comment when leaf routes land in later batches. Active state uses `pathname.startsWith(url)`.
- Widths use `w-[var(--sidebar-width)]` (never `w-[--sidebar-width]`).

**`src/components/company-switcher.tsx`** — Radix `DropdownMenu` trigger showing avatar + current company name.
- Stub companies list (3 entries with initials fallbacks).
- Selected id stored in `React.Context` + `localStorage` key `gridmind:active-company`; check-mark on active row.

**`src/components/notifications-bell.tsx`** — `DropdownMenu` with `Bell` icon + unread `Badge`.
- Local `useState` stub list (3 items). "Mark all read" clears count. Empty state copy: "You're all caught up".

**`src/components/user-menu.tsx`** — `DropdownMenu` with avatar (initials fallback), name/email from `supabase.auth.getUser()`, links: Profile (`/profile`, stub), Settings (`/settings`, stub), Sign out.
- Sign out follows the "Sign-Out Hygiene" pattern: `queryClient.cancelQueries()` → `queryClient.clear()` → `supabase.auth.signOut()` → `navigate({ to: '/auth', replace: true })`. Reads `queryClient` via `useQueryClient()` from `@tanstack/react-query`.

**`src/components/app-shell.tsx`** — glues everything.
- `<SidebarProvider>` wrapping a `flex min-h-screen w-full` container:
  - `<AppSidebar />` on the left.
  - Right column: sticky `<header>` (`border-b bg-background`) with `SidebarTrigger`, breadcrumb slot (`<Breadcrumb />` from shadcn, single "Dashboard" crumb for now — real crumbs land per-route later via a `useBreadcrumb` hook stub), and the right-hand cluster (`CompanySwitcher`, `NotificationsBell`, `ThemeToggle`, `UserMenu`).
  - `<main className="flex-1 p-6">{children}</main>`.
- Responsive header uses the two-column grid pattern (`grid-cols-[minmax(0,1fr)_auto]` → `sm:flex`).
- `SidebarProvider` already persists open/closed to a cookie and supports Cmd/Ctrl+B; no extra wiring needed for the keyboard shortcut or persistence, only confirm defaults.

**`src/components/breadcrumbs.tsx`** — thin wrapper exporting `AppBreadcrumbs` that accepts `{ items: { label: string; to?: string }[] }`. Renders shadcn Breadcrumb primitives with the last item marked as page. Dashboard uses `[{ label: 'Dashboard' }]`.

### Dashboard rebuild (`_authenticated/dashboard.tsx`)

- Page title "Dashboard" + "Overview of active EPC projects" muted subtitle.
- 4 stub KPI cards (`bg-card` + `border-border`): "Active Projects", "Open Punchlist", "Procurement in Transit", "O&M Tickets".
- Recent-activity card with skeleton state on first render (~600 ms mock timeout), transitioning to the empty state ("No recent activity. New events will appear here.") since we have no data yet.
- All copy uses "O&M", "C&I", "Green H₂" spelling verbatim where mentioned.

### Design constraints

- Semantic tokens only: `bg-sidebar`, `bg-sidebar-accent`, `text-sidebar-foreground`, `bg-background`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, etc. No raw hex/rgb.
- Fonts: body `font-sans` (Inter), wordmark `font-display` (Space Grotesk).
- Icon-only sidebar state hides labels, keeps icons; mobile becomes an off-canvas sheet automatically via shadcn's `collapsible="icon"` + built-in mobile sheet.

### Verification

- Typecheck passes.
- `rg -n "#[0-9a-fA-F]{3,8}|rgb\(|rgba\(" src/components/app-*.tsx src/components/*-menu.tsx src/components/*-switcher.tsx src/components/*-bell.tsx src/components/breadcrumbs.tsx src/routes/_authenticated/` returns no color literals.
- Playwright: sign in with an existing test session, navigate to `/dashboard`, verify sidebar renders, Cmd+B toggles icon-only mode, dropdowns open, active nav item highlights.

### Out of scope (later batches)

- Real leaf routes for each module (`/crm`, `/engineering`, …).
- Real notifications data + WebSocket.
- Real multi-company session context — the switcher writes localStorage but no downstream code reads it yet.
- Breadcrumb hook that composes per-route trails.
