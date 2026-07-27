# GridMind EPC — Launch Checklist (Go-Live Gate)

This is the go-live gate for GridMind EPC. Work top-to-bottom. Every box must be ticked before the DNS cutover to **gridmindepc.com**. Consistent with `docs/operator-env.md`, `docs/pitr-runbook.md`, and the pinned test commands (`bun run test` for unit, `bun run test:all` for the full suite).

For Day 2 (post-launch) operations, see `docs/ops-runbook.md` for on-call playbooks, `docs/ops-decisions.md` for the operational thresholds and SLOs backing the observability dashboards, and `docs/uat-checklist.md` for persona-based UAT sign-off.

Do not edit historical rows. Corrections go in a new row that references the mistaken one.

---

## 1 — Environment & Secrets

Verify **in the Lovable Cloud secret store**, never in the repo. Values must never appear in git history or `.env` committed files.

- [ ] `PUBLIC_HOOK_SIGNING_SECRET` set and **≥ 64 characters** (generated via `openssl rand -hex 32` or stronger)
- [ ] `PUBLIC_HOOK_ENFORCE=block` (production; see §2 for the warn→block promotion)
- [ ] `PUBLIC_HOOK_IP_ALLOWLIST` populated with production integrator CIDRs (comma-separated, no `0.0.0.0/0`)
- [ ] `SUPABASE_URL` present server-side
- [ ] `SUPABASE_PUBLISHABLE_KEY` present server-side
- [ ] `SUPABASE_SERVICE_ROLE_KEY` present server-side (Lovable Cloud managed)
- [ ] `LOVABLE_API_KEY` present
- [ ] `CRON_APIKEY` set and rotated within the last 90 days
- [ ] EmailJS vars present if scheduled reports are enabled (`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`)
- [ ] `package.json` pins **Vite `^8.0.16`**
- [ ] `package.json` has top-level `"overrides": { "entities": ">=4.5.0" }` (NOT nested under `pnpm`)

### Verification snippets

Service-role symbol must not appear in any client-bundled file:

```bash
grep -rn "SERVICE_ROLE" src/ --include="*.tsx" | grep -v routes/api
# Expected: (no output)
grep -rn "SERVICE_ROLE" src/ --include="*.ts"  | grep -v routes/api | grep -v integrations/supabase | grep -v lib/public-api | grep -Ev '\.functions\.ts|\.server\.ts'
# Expected: (no output)
```

Committed-secret sweep:

```bash
git grep -nE 'sk_live_|sk_test_[A-Za-z0-9]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|SUPABASE_SERVICE_ROLE_KEY\s*=\s*[A-Za-z0-9\.\-_]{20,}' -- ':!docs/**' ':!*.md'
# Expected: (no output)
```

- [ ] Both greps return empty

---

## 2 — Warn → Block Promotion (Production Guard Rollout)

The public-hook guard ships in `warn` mode so integrators can be onboarded without silent rejection, then promotes to `block`.

- [ ] Ran production with `PUBLIC_HOOK_ENFORCE=warn` for **≥ 14 consecutive days**
- [ ] Reviewed `/admin/health` daily for `public_hook.ip_denied` and `public_hook.signature_failed` counters
- [ ] Cross-checked corresponding rows in `audit_logs` (action prefix `public_hook.`) — every denial has a known integrator + root cause
- [ ] Fixed each denial by (a) adding the integrator CIDR to `PUBLIC_HOOK_IP_ALLOWLIST`, (b) reissuing/rotating the API key with the correct HMAC secret, or (c) confirming the caller was truly hostile and left denied
- [ ] **Zero legitimate-traffic denials for 7 consecutive days** immediately prior to the flip
- [ ] Set `PUBLIC_HOOK_ENFORCE=block` in the Lovable Cloud secret store and redeployed
- [ ] Verified live: a call with a bad API key returns **HTTP 401**
  ```bash
  curl -i -X POST https://gridmindepc.com/api/public/hooks/ping \
    -H 'authorization: Bearer not-a-real-key' \
    -H 'content-type: application/json' -d '{}'
  # Expect: HTTP/1.1 401
  ```
- [ ] Verified live: a call from an off-allowlist IP returns **HTTP 403**
  ```bash
  # From a host outside PUBLIC_HOOK_IP_ALLOWLIST, using a valid signed request:
  # Expect: HTTP/1.1 403
  ```
- [ ] Rollback documented: revert `PUBLIC_HOOK_ENFORCE` to `warn` in the Lovable Cloud secret store and redeploy — no code change required. `/admin/health` continues to record signals in either mode.

---

## 3 — Backup & Retention Verification

- [ ] Latest PITR drill in `docs/pitr-runbook.md` completed **< 35 days ago** with **Result = PASS** recorded in the drill log
- [ ] `/api/cron/storage-check` green: **no `ops.storage_check_failed` rows in the last 7 days**
  ```sql
  select count(*) from public.audit_logs
   where action = 'ops.storage_check_failed'
     and created_at > now() - interval '7 days';
  -- Expect: 0
  ```
- [ ] Retention job ran within the last 24h:
  ```sql
  select max(created_at) from public.audit_logs
   where action = 'ops.audit_retention_run';
  -- Expect: within 24h
  ```
- [ ] 7-year financial retention policies present for every company:
  ```sql
  select company_id, entity, retention_days
    from public.audit_log_retention_policies
   where entity in ('invoices','debit_notes','pay_applications','change_orders','cash_flows','budgets')
   order by company_id, entity;
  -- Expect: retention_days >= 2555 for every row
  ```

---

## 4 — Seed & Demo Cleanup

- [ ] Demo company removed (`delete from public.companies where slug like 'demo-%'` or equivalent)
- [ ] Demo users removed from `auth.users` and `public.profiles`
- [ ] Demo/seed API keys revoked — every seeded row in `public.api_keys` has `revoked_at is not null`
- [ ] Test webhook endpoints disabled (`update public.webhook_endpoints set enabled = false` for any `*.test`, `webhook.site`, `ngrok`, `localhost`, or staging URLs)
- [ ] e2e / fixture tenants deleted (`companies.slug` starting with `e2e-` or `fixture-`)
- [ ] Invite links older than 7 days expired:
  ```sql
  update public.invites set expires_at = now()
   where accepted_at is null
     and created_at < now() - interval '7 days'
     and expires_at > now();
  ```

---

## 5 — Quality Gates

All must be green on the release candidate commit.

- [ ] `bun run lint` — clean (no warnings, no `console.log` in `src/**`)
- [ ] `bun run build` — clean (no type or bundler errors)
- [ ] `bun run test` — green (unit suite, `vitest.config.ts`)
- [ ] `bun run test:all` — green **with the dev server actually running** (api + rls + e2e suites executed, not skipped). Confirm the run log lists tests under `tests/api/`, `tests/rls/`, and `tests/e2e/` — a suite showing `0 tests` means the harness was skipped and this box does NOT count as ticked.
- [ ] E2E smoke golden path passed on the release candidate (login → project wizard → phase gate → PO approve → proposal PDF → audit verification)

---

## 6 — Go-Live Signoff

By signing below, each owner attests: **"All boxes above checked; warn→block promotion complete; DNS cutover to gridmindepc.com approved."**

Modules in scope include CRM, Engineering, Procurement, Finance, Field, QA/QC, **O&M**, **C&I**, and **Green H₂**.

| Role             | Name | Date (UTC) | Signature |
| ---------------- | ---- | ---------- | --------- |
| Engineering Lead |      |            |           |
| Security Owner   |      |            |           |
| Operations Owner |      |            |           |

---

## 7 — Day 2 Observability Sign-off

Confirm the operational dashboards and controls that back `docs/ops-runbook.md` and
`docs/ops-decisions.md` are live and reviewed before cutover.

- [ ] `/admin/health` reviewed — no unexplained `public_hook.*` denials or cron gaps
- [ ] `/admin/performance` reviewed — memory, disk, connections, and WAL within thresholds defined in `docs/ops-decisions.md`
- [ ] `/admin/ops-alerts` reviewed — alert routing confirmed against severity mapping in `docs/ops-decisions.md`
- [ ] `/admin/slo` reviewed — SLO targets from `docs/ops-decisions.md` are tracking and not in breach
- [ ] Cron audit logging confirmed for all scheduled jobs (`escalations`, `pm-work-orders`, `scheduled-reports`, `audit-retention`, `webhook-dispatch`) — each has recent `audit_logs` rows
- [ ] Access review completed — admin/service-role access limited to authorized personnel, on-call escalation contacts in `docs/ops-runbook.md` §2 are current

---

_Once the table is fully signed, proceed with the DNS cutover to **gridmindepc.com** per the operations runbook._
