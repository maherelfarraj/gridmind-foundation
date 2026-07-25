## Status confirmed first

- `maher@next.jo` is signed up, attached to **GSI**, and holds **company_admin + super_admin**. No further bootstrap needed.
- All 18 `@gridmind.captial` invites are still **pending** — none redeemed — so revoking them is clean.

## Intent (per your answer)

The 18 are a **demo roster**. GSI must contain only real people, so they move to **Sandbox**.

## What I'll do

1. **Revoke from GSI** — set all 18 pending GSI invites to `revoked`, write one audit row per invite plus a single `admin.invite_batch_revoked` summary row under GSI. Their tokens stop working immediately.
2. **Recreate under Sandbox** — re-issue the same 18 email → role mappings against the Sandbox tenant using the app's `create_invite` path (the guarded server function), not raw SQL.
3. **Handle the two roles the guard blocks** — `create_invite` refuses `super_admin`. Rather than routing around it, `maher.elfarraj@gridmind.captial` will be issued as `company_admin` in Sandbox. That still leaves two `company_admin`s in the demo tenant (maher.elfarraj + company.admin), satisfying the no-lockout rule. If you want a true `super_admin` in Sandbox, tell me and I'll surface it as an explicit request instead of doing it silently.
4. **Report** — a table of all 18 with: old GSI status (revoked), new Sandbox invite ID, role, and redeem link.

## Standing rule going forward

No invites and no role rows inserted at SQL level. Every grant goes through `create_invite` / `grantRole`. If a guard blocks something, I stop and report the block to you rather than bypassing it. I'll save this as a project rule so it survives future sessions.

## Technical notes

- Revocation touches `public.invites.status` only; rows are kept for the audit trail rather than deleted.
- Sandbox tenant: `04a05a8d-7972-4f80-b935-508793df9772`. GSI: `1ab0730f-d6fa-4678-b1b7-7f752c80eceb`.
- Invites are created as the authenticated super_admin so `create_invite`'s company-admin check passes; the actor is recorded in `invited_by`.
- No frontend changes — Settings → Users & roles already lists invites per tenant.
