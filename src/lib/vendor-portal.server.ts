// P-222 — Vendor portal server-only helpers (never imported by the client).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";

import {
  normalizeVendorExposure,
  vendorPortalRateKey,
  type VendorExposure,
  type VendorMembershipStatus,
} from "./vendor-portal.rules";

export interface CallerMembership {
  id: string;
  company_id: string;
  vendor_id: string;
  status: VendorMembershipStatus;
  exposure: VendorExposure;
  expires_at: string | null;
}

export function httpError(code: string, statusCode: number): Error {
  return Object.assign(new Error(code), { statusCode });
}

/**
 * Load the caller's own membership row for a vendor (RLS: own-row SELECT).
 * Throws a typed 403 when there is no membership at all.
 */
export async function loadCallerMembership(
  context: AuthContext,
  vendorId: string,
): Promise<CallerMembership> {
  const { data, error } = await context.supabase
    .from("vendor_portal_memberships")
    .select("id, company_id, vendor_id, status, exposure, expires_at")
    .eq("vendor_id", vendorId)
    .eq("user_id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError("vendor_portal_access_denied", 403);
  const row = data as {
    id: string;
    company_id: string;
    vendor_id: string;
    status: VendorMembershipStatus;
    exposure: Json;
    expires_at: string | null;
  };
  return {
    id: row.id,
    company_id: row.company_id,
    vendor_id: row.vendor_id,
    status: row.status,
    exposure: normalizeVendorExposure(row.exposure),
    expires_at: row.expires_at,
  };
}

/**
 * Consume one token from the membership's bucket. Fails OPEN (with a
 * structured log) when the RPC itself errors, so a rate-limiter outage never
 * locks vendors out; throws 429 only on an explicit deny.
 */
export async function rateLimitMembership(
  context: AuthContext,
  membershipId: string,
): Promise<void> {
  try {
    const { data, error } = await context.supabase.rpc("consume_rate_limit", {
      p_key: vendorPortalRateKey(membershipId),
      p_capacity: 60,
      p_refill_per_sec: 1,
    });
    if (error) {
      console.warn(
        JSON.stringify({
          event: "vendor_portal.rate_limit_unavailable",
          membership_id: membershipId,
          error: error.message,
        }),
      );
      return;
    }
    if (data === false) throw httpError("vendor_portal_rate_limited", 429);
  } catch (err) {
    if (err instanceof Error && err.message === "vendor_portal_rate_limited") throw err;
    console.warn(
      JSON.stringify({
        event: "vendor_portal.rate_limit_unavailable",
        membership_id: membershipId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Guard + rate-limit pipeline shared by every vendor-facing server fn. */
export async function vendorGate(
  context: AuthContext,
  vendorId: string,
): Promise<CallerMembership> {
  const membership = await loadCallerMembership(context, vendorId);
  await rateLimitMembership(context, membership.id);
  return membership;
}

// ---------------------------------------------------------------------------
// Internal (EPC-side) helpers
// ---------------------------------------------------------------------------

export async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id?: string } | null)?.company_id;
  if (!cid) throw httpError("no_company", 403);
  return cid;
}

export async function hasVendorPortalWriteAccess(context: AuthContext): Promise<boolean> {
  for (const role of ["procurement_admin", "company_admin"] as const) {
    const { data } = await context.supabase.rpc("has_company_role", { p_role: role });
    if (data === true) return true;
  }
  return false;
}

export async function assertVendorPortalAdmin(context: AuthContext): Promise<void> {
  if (!(await hasVendorPortalWriteAccess(context))) {
    throw httpError("forbidden_role", 403);
  }
}

export async function writeAuditLog(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await context.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "vendor_portal_memberships",
    p_entity_id: entityId,
    p_metadata: metadata as unknown as Json,
  });
}

export async function writePortalEvent(
  context: AuthContext,
  vendorId: string,
  companyId: string,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await context.supabase.rpc("vendor_portal_write_event", {
    p_vendor_id: vendorId,
    p_event: event,
    p_metadata: metadata as unknown as Json,
    p_company_id: companyId,
  });
  if (error) {
    console.warn(
      JSON.stringify({
        event: "vendor_portal.event_write_failed",
        vendor_id: vendorId,
        portal_event: event,
        error: error.message,
      }),
    );
  }
}
