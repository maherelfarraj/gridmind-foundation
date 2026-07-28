// P-250 — Test-suite tenant teardown.
//
// Every suite that creates fixture tenants MUST call `purgeFixtureTenants`
// in its `afterAll`. Naive `companies.delete()` silently no-ops whenever any
// child table (audit_logs, notifications, …) still holds a hard FK, which is
// how the fixture-tenant "regrowth" problem happened: suites littered
// hundreds of tenants that never got collected.
//
// `public.fixture_purge_tenants` is the audited purge path: SECURITY DEFINER,
// service_role-only, refuses to touch the protected tenants (gsi/sandbox),
// cascades every public table carrying `company_id`, and writes an
// `ops.fixture_purge` audit row.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Tenants that the purge path will never delete, whatever a suite passes. */
export const PROTECTED_TENANT_SLUGS = ["gsi", "sandbox"] as const;

/**
 * Delete the given fixture tenants and all of their rows via the audited
 * purge routine. Safe to call with undefined/duplicate ids. Never throws —
 * teardown must not mask a suite's real failure — but logs on error.
 */
export async function purgeFixtureTenants(
  svc: SupabaseClient<never, never, never> | { rpc: SupabaseClient["rpc"] },
  companyIds: ReadonlyArray<string | null | undefined>,
): Promise<number> {
  const ids = Array.from(new Set(companyIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return 0;
  const rpc = (
    svc as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc.bind(svc);

  // One retry: the purge cascades every company-scoped table and can lose a
  // race with a busy statement/lock timeout on a loaded database.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { data, error } = await rpc("fixture_purge_tenants", { p_company_ids: ids });
      if (!error) return typeof data === "number" ? data : 0;
      if (attempt === 2) {
        console.info("[fixture-teardown] purge failed", error);
        return 0;
      }
    } catch (err) {
      if (attempt === 2) {
        console.info("[fixture-teardown] purge threw", err);
        return 0;
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return 0;
}

/** Best-effort auth user teardown that pairs with `purgeFixtureTenants`. */
export async function deleteFixtureUsers(
  svc: { auth: { admin: { deleteUser: (id: string) => Promise<unknown> } } },
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  for (const id of userIds) {
    if (!id) continue;
    try {
      await svc.auth.admin.deleteUser(id);
    } catch {
      /* ignore */
    }
  }
}
