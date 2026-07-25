## Goal

Create the real GSI tenant, get `maher@next.jo` in as `company_admin` + `super_admin`, then send the first real invites from the app.

## The bootstrap catch (why the UI alone can't do it)

Role grants go through `assert_can_grant_role`, which requires the caller to already be a `company_admin` of that company (and `super_admin` to grant `super_admin`). Right now the database has no real admin — only test/fixture tenants from the RLS and E2E suites. So the very first admin must be granted once at the database level; everything after that happens in the app.

## Steps

1. **You sign up** at `/signup` with `maher@next.jo` and confirm the email. Nothing else — do not create a project yet.
2. **Create the GSI tenant + bootstrap the admin** (one migration, idempotent, matched by email):
   - insert company `GSI` (slug `gsi`, plan tier — see question below),
   - enable all module access rules for it,
   - insert/repoint the `profiles` row for that auth user to the GSI company,
   - insert `user_roles` rows: `company_admin` and `super_admin`,
   - write an audit-log entry recording the bootstrap.
   If the auth user isn't found, the migration raises a clear notice instead of failing.
3. **Verify in the app**: sign in, confirm Settings → Users & roles shows you with both roles, the company switcher shows GSI, and the super-admin-only `/admin` area (tenants, health) is reachable.
4. **Invite the first real users** from Settings → Users & roles (bulk invite dialog). Invites use `create_invite`, are hashed-token + expiring, and land on `/accept-invite`. Note: invite emails need email sending configured — if that isn't set up yet, the app still generates invite links you can send manually, and we can wire branded auth/invite email afterwards.
5. **Optional cleanup**: the database currently holds ~100 leftover test tenants (`E2E …`, `P-131 Fixture …`, `P132 …`, `Demo EPC Co`). Recommend purging them so the real tenant list is clean — this is a destructive delete, done only if you say yes.

## Technical notes

- Roles stay exclusively in `public.user_roles` (never on `profiles`), scoped per company.
- The bootstrap grant is a one-time migration; all subsequent grants/revokes go through the app's server functions, which call `assert_can_grant_role` first.
- The existing last-company-admin guard prevents you from accidentally revoking your own admin later.

## Need from you at implementation time

- GSI plan tier: `enterprise` (unlocks Green H₂ + all modules) unless you say otherwise.
- The list of first invitees: email + role for each.
- Whether to purge the ~100 test tenants in the same pass.
