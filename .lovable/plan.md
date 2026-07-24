## P-023 — Super Admin console (tenants list / create / detail)

### 1. Additive migration (`companies`)

```sql
alter table public.companies add column if not exists legal_name text;
alter table public.companies add column if not exists contact_email text;
update public.companies set legal_name = name where legal_name is null;

-- Full super_admin management policy (member-read policy stays intact)
drop policy if exists companies_super_admin_all on public.companies;
create policy companies_super_admin_all on public.companies
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'super_admin'));
```

After apply: show columns + all `pg_policies` rows for `public.companies` (per standing rule).

### 2. Server functions — `src/lib/tenants.functions.ts`

All `.middleware([attachSupabaseAuth])`, `requireSupabaseAuth`, then gate with `has_role(auth.uid(),'super_admin')` via `context.supabase.rpc('has_role', ...)`. Throw `Object.assign(new Error('Forbidden'), { statusCode: 403 })` on failure so `errorMiddleware` surfaces 403.

- `listTenants({ search? })` → id, name (slug), legal_name, contact_email, plan_tier, created_at, member_count (aggregate via 2nd query on `profiles` grouped by company_id — or per-row count via `profiles(count)` embed). Server-side filter by ilike on legal_name/name/contact_email.
- `createTenant({ legalName, slug, contactEmail, planTier })` — zod validates slug ≤ 20, email valid, planTier enum. Insert companies (name=slug, legal_name, contact_email, plan_tier), then `write_audit_log('tenant.created','companies', id, {...})`.
- `getTenantDetail({ companyId })` → company row + memberCount, adminCount (user_roles where role in company_admin/super_admin), inviteCount (invites where status='pending').
- `updateTenantPlan({ companyId, planTier })` — read current plan, update, audit `tenant.plan_changed` with `{ from, to }`.

### 3. Routes

- `src/routes/_authenticated/admin.tsx` — pathless layout with `<Outlet/>`; `beforeLoad` calls `getCurrentUserRoles` and throws 404 (`notFound()`) if user lacks super_admin. Simple heading "Platform admin".
- `src/routes/_authenticated/admin.tenants.tsx` — list page: search input (debounced), shadcn Table, plan badge (starter=secondary, growth=default, enterprise=accent), skeleton (5 rows), empty state, error state with retry (`router.invalidate()`), "Create tenant" dialog (react-hook-form + zod). Row click → detail.
- `src/routes/_authenticated/admin.tenants.$companyId.tsx` — header (legal name + plan badge), Tenant ID card (mono UUID + Copy button using `navigator.clipboard.writeText`, sonner toast), plan editor (Select + Save, disabled while pending, audits), stats grid (members/admins/invites).

Both list & detail: `errorComponent` + `notFoundComponent` per route rules; loaders use `context.queryClient.ensureQueryData` + `useSuspenseQuery`.

### 4. Sidebar gating

Replace the hardcoded "Admin" nav item behavior in `src/components/app-sidebar.tsx`:
- Add a small hook `useIsSuperAdmin()` that runs `useQuery({ queryFn: getCurrentUserRoles })` (returns bool). Render the "Admin" item only when true, pointing to `/admin/tenants`. "Users" item stays as-is.

Client hiding is UX only — every RPC re-checks super_admin server-side.

### 5. Negative test (server-side auth)

After live checks, invoke `listTenants` while signed in as a non-super_admin (temporarily sign in as demo-pm@ or similar); expect 403 from the RPC (not just hidden nav). Report the raw response.

### 6. Live checklist (as demo-admin, who has super_admin)

- [ ] Admin > Tenants nav visible; lists Demo EPC Co with enterprise badge + member count
- [ ] Create "Test Co B" (starter) → row appears, audit_logs has `tenant.created`
- [ ] Detail page: copy Tenant ID; change starter → growth; audit_logs has `tenant.plan_changed` `{ from:'starter', to:'growth' }`
- [ ] Loading skeleton / empty / error states verified
- [ ] Non-super_admin call to listTenants returns 403

Design tokens only; no raw hex.

Then: `next → P-024`.
