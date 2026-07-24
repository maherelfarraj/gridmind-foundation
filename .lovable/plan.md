
# Batch 03 checkpoint — live behavior sweep

Schema sweep already passed (RLS on `companies`, `company_branding`, `notification_prefs`; `companies` has `legal_name`, `contact_email`, `phone`, `address`). Audit log currently shows only `tenant.created` / `tenant.plan_changed` — the rest of the sweep will populate it.

## What I'll do (build mode)

Drive the app headlessly as demo-admin with Playwright against `http://localhost:8080`, restoring the managed Supabase session from the sandbox env. Capture a screenshot at each step for evidence and print the final URL + any console errors per step.

1. **Auth**
   - Sign out from `/dashboard`, confirm redirect to `/auth`.
   - Visit `/settings/users` while logged out → expect redirect to `/auth`.
   - Sign back in as demo-admin.
2. **/settings/users**
   - Members tab loads; open "Invite member" → send a throwaway invite (`sweep+1@example.test`, role `engineer`).
   - Open "Bulk invite" → paste 2 valid + 1 invalid row, confirm preview validation, submit the valid rows.
   - Switch to Invitations tab; confirm new rows appear as `pending`; Resend + Revoke one row.
   - Last-admin guard: open Manage roles on the sole `company_admin`, attempt to revoke `company_admin` → expect refusal toast, no DB change.
3. **/settings/departments**
   - Confirm 9 cards render. Assign demo-admin as admin on `engineering`, then unassign — expect two audit rows.
4. **/admin/tenants**
   - Confirm Demo EPC Co + Test Co B visible. Open Demo EPC Co, change plan tier (Starter↔Growth), revert.
5. **/settings/modules** — confirm read-only (no toggles enabled for company_admin view).
6. **/settings/permissions-simulator** — pick two roles, confirm compare renders and no network mutations fire (watch requests).
7. **/settings/company** — edit legal name + footer text, save; upload a tiny PNG logo, confirm preview via signed URL; revert.
8. **/settings/profile** — change locale to `es` then back to `en`; upload avatar; confirm save toasts.

## Verification after the sweep

Re-run:

```sql
select action, count(*) from audit_logs group by action order by 2 desc;
```

Expect new rows for: `invite.created`, `invite.bulk_sent`, `invite.resent`, `invite.revoked`, `role.granted`, `role.revoked`, `tenant.plan_changed`, `branding.updated`, `company.updated`, `profile.updated`, `notification_prefs.updated` (where triggered).

Also list latest 20 rows so you can see the trail.

## Out of scope

- GitHub repo migration listing (I have no repo visibility from here) — confirm on your side that `supabase/migrations/` contains 0001–0014.
- No schema changes, no seed changes, no code edits. This is verification only. If a step reveals a real bug, I'll stop and report before touching code.

Approve to switch to build mode and run the sweep.
