// P-222 — Vendor portal server functions.
//
// SECURITY: vendor-facing functions load the caller's membership, rate-limit
// by membership id, then call ONLY the SECURITY DEFINER vendor_portal_* RPCs.
// They never read internal tables directly.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";
import {
  DEFAULT_VENDOR_EXPOSURE,
  inviteExpiryDate,
  normalizeVendorExposure,
  exposureDiff,
  type VendorExposure,
  type VendorMembershipStatus,
} from "@/lib/vendor-portal.rules";
import {
  assertVendorPortalAdmin,
  currentCompanyId,
  hasVendorPortalWriteAccess,
  httpError,
  vendorGate,
  writeAuditLog,
  writePortalEvent,
} from "@/lib/vendor-portal.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorMembershipCard {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  company_id: string;
  company_name: string | null;
  logo_url: string | null;
  status: VendorMembershipStatus;
  exposure: VendorExposure;
  expires_at: string | null;
  last_seen_at: string | null;
  accepted_at: string | null;
}

export interface VendorPoRow {
  id: string;
  po_number: string;
  status: string;
  currency_code: string;
  issued_at: string | null;
  required_by_date: string | null;
  total_amount: number;
  delivery_address: string | null;
  lines: Json;
  acknowledged_at: string | null;
  acknowledgment_status: "accepted" | "accepted_with_comments" | "rejected" | null;
  acknowledgment_note: string | null;
  acknowledged_by_email: string | null;
}

export interface VendorDeliveryRow {
  id: string;
  reference: string | null;
  status: string;
  carrier: string | null;
  expected_date: string | null;
  delivered_at: string | null;
  po_number: string | null;
  notes: string | null;
}

export interface VendorInvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  currency_code: string;
  amount: number;
  paid_amount: number;
  issue_date: string | null;
  due_date: string | null;
  paid_at: string | null;
}

export interface VendorDocumentRow {
  id: string;
  title: string;
  category: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface VendorPortalMemberRow {
  id: string;
  email: string;
  status: VendorMembershipStatus;
  exposure: VendorExposure;
  expires_at: string | null;
  last_seen_at: string | null;
  accepted_at: string | null;
  invite_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface VendorPortalEventRow {
  id: string;
  event: string;
  actor_type: string;
  metadata: Json;
  created_at: string;
}

const vendorIdInput = z.object({ vendorId: z.string().uuid() });
const idInput = z.object({ id: z.string().uuid() });
const exposureSchema = z.object({
  pos: z.boolean(),
  deliveries: z.boolean(),
  invoices: z.boolean(),
  documents: z.boolean(),
  scorecard: z.boolean(),
});

// ---------------------------------------------------------------------------
// VENDOR-FACING
// ---------------------------------------------------------------------------

export const listMyVendorMemberships = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<VendorMembershipCard[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("vendor_portal_my_memberships");
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      vendor_id: String(r.vendor_id),
      vendor_name: (r.vendor_name as string | null) ?? null,
      company_id: String(r.company_id),
      company_name: (r.company_name as string | null) ?? null,
      logo_url: (r.logo_url as string | null) ?? null,
      status: r.status as VendorMembershipStatus,
      exposure: normalizeVendorExposure(r.exposure),
      expires_at: (r.expires_at as string | null) ?? null,
      last_seen_at: (r.last_seen_at as string | null) ?? null,
      accepted_at: (r.accepted_at as string | null) ?? null,
    }));
  });

export const getVendorPortalPos = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorPoRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("vendor_portal_get_pos", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw httpError(error.message, 403);
    return (rows ?? []) as unknown as VendorPoRow[];
  });

export const getVendorPortalDeliveries = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorDeliveryRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("vendor_portal_get_deliveries", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw httpError(error.message, 403);
    return (rows ?? []) as VendorDeliveryRow[];
  });

export const getVendorPortalInvoices = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorInvoiceRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("vendor_portal_get_invoices", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw httpError(error.message, 403);
    return (rows ?? []) as VendorInvoiceRow[];
  });

export const getVendorPortalDocuments = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorDocumentRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("vendor_portal_get_documents", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw httpError(error.message, 403);
    return (rows ?? []) as VendorDocumentRow[];
  });

/** Called after invite redemption — activates invited vendor memberships. */
export const acceptVendorPortalInvites = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ activated: number }> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("vendor_portal_accept_invites");
    if (error) throw error;
    return { activated: Number(data ?? 0) };
  });

/** Is the signed-in user a vendor portal user (used for route redirects)? */
export const getMyVendorPortalStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ isVendorViewer: boolean }> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.user.id)
      .eq("role", "vendor_viewer")
      .limit(1);
    if (error) throw error;
    return { isVendorViewer: (data ?? []).length > 0 };
  });

// ---------------------------------------------------------------------------
// INTERNAL (procurement) — membership administration
// ---------------------------------------------------------------------------

export const getVendorPortalAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasVendorPortalWriteAccess(context) };
  });

export const listVendorPortalMembers = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorPortalMemberRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("vendor_portal_memberships")
      .select(
        "id, email, status, exposure, expires_at, last_seen_at, accepted_at, invite_id, user_id, created_at",
      )
      .eq("vendor_id", data.vendorId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      status: r.status as VendorMembershipStatus,
      exposure: normalizeVendorExposure(r.exposure),
      expires_at: (r.expires_at as string | null) ?? null,
      last_seen_at: (r.last_seen_at as string | null) ?? null,
      accepted_at: (r.accepted_at as string | null) ?? null,
      invite_id: (r.invite_id as string | null) ?? null,
      user_id: (r.user_id as string | null) ?? null,
      created_at: String(r.created_at),
    }));
  });

export const listVendorPortalEvents = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorPortalEventRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("vendor_portal_events")
      .select("id, event, actor_type, metadata, created_at")
      .eq("vendor_id", data.vendorId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (rows ?? []) as VendorPortalEventRow[];
  });

const inviteInput = z.object({
  vendorId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  exposure: exposureSchema.partial().optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const inviteVendorContact = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inviteInput.parse(raw))
  .handler(
    async ({
      context,
      data,
    }): Promise<{ membership_id: string; token: string; expires_at: string }> => {
      requireSupabaseAuth(context);
      await assertVendorPortalAdmin(context);
      const companyId = await currentCompanyId(context);

      const { data: vendor } = await context.supabase
        .from("vendors")
        .select("id, company_id, name")
        .eq("id", data.vendorId)
        .maybeSingle();
      if (!vendor || (vendor as { company_id?: string }).company_id !== companyId) {
        throw httpError("vendor_not_found", 404);
      }

      const { data: existing } = await context.supabase
        .from("vendor_portal_memberships")
        .select("id")
        .eq("company_id", companyId)
        .eq("vendor_id", data.vendorId)
        .eq("email", data.email)
        .maybeSingle();
      if (existing) throw httpError("vendor_portal_member_exists", 409);

      const { data: token, error: invErr } = await context.supabase.rpc("create_invite", {
        p_company_id: companyId,
        p_email: data.email,
        p_role: "vendor_viewer",
      });
      if (invErr) throw invErr;

      const { data: inviteRow } = await context.supabase
        .from("invites")
        .select("id")
        .eq("company_id", companyId)
        .eq("email", data.email)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const expiresAt = inviteExpiryDate(data.expiresInDays).toISOString();
      const exposure = { ...DEFAULT_VENDOR_EXPOSURE, ...(data.exposure ?? {}) };

      const { data: inserted, error: insErr } = await context.supabase
        .from("vendor_portal_memberships")
        .insert({
          company_id: companyId,
          vendor_id: data.vendorId,
          email: data.email,
          status: "invited",
          exposure: exposure as unknown as Json,
          invite_id: (inviteRow as { id?: string } | null)?.id ?? null,
          invited_by: context.user.id,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (insErr) {
        if (String(insErr.message).includes("vendor_portal_memberships_uk")) {
          throw httpError("vendor_portal_member_exists", 409);
        }
        throw insErr;
      }

      const membershipId = (inserted as { id: string }).id;
      await writePortalEvent(context, data.vendorId, companyId, "vendor_portal.member_invited", {
        email: data.email,
        expires_at: expiresAt,
      });
      await writeAuditLog(context, "vendor_portal.member_invited", membershipId, {
        vendor_id: data.vendorId,
        company_id: companyId,
        email: data.email,
        exposure,
        expires_at: expiresAt,
      });

      return { membership_id: membershipId, token: String(token), expires_at: expiresAt };
    },
  );

export const suspendVendorPortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("vendor_portal_memberships")
      .update({ status: "suspended" })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id, vendor_id, email")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError("not_found", 404);
    const r = row as { vendor_id: string; email: string };
    await writePortalEvent(context, r.vendor_id, companyId, "vendor_portal.member_suspended", {
      email: r.email,
    });
    await writeAuditLog(context, "vendor_portal.member_suspended", data.id, {
      vendor_id: r.vendor_id,
      email: r.email,
    });
    return { ok: true };
  });

export const revokeVendorPortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("vendor_portal_memberships")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id, vendor_id, email")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError("not_found", 404);
    const r = row as { vendor_id: string; email: string };
    await writePortalEvent(context, r.vendor_id, companyId, "vendor_portal.member_revoked", {
      email: r.email,
    });
    await writeAuditLog(context, "vendor_portal.member_revoked", data.id, {
      vendor_id: r.vendor_id,
      email: r.email,
    });
    return { ok: true };
  });

export const reactivateVendorPortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("vendor_portal_memberships")
      .update({ status: "active" })
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id, vendor_id, email, user_id")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError("not_found", 404);
    const r = row as { vendor_id: string; email: string };
    await writePortalEvent(context, r.vendor_id, companyId, "vendor_portal.member_reactivated", {
      email: r.email,
    });
    await writeAuditLog(context, "vendor_portal.member_reactivated", data.id, {
      vendor_id: r.vendor_id,
      email: r.email,
    });
    return { ok: true };
  });

const exposureInput = z.object({ id: z.string().uuid(), exposure: exposureSchema });

export const updateVendorPortalExposure = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => exposureInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);

    const { data: before } = await context.supabase
      .from("vendor_portal_memberships")
      .select("id, vendor_id, email, exposure")
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!before) throw httpError("not_found", 404);
    const prev = normalizeVendorExposure((before as { exposure: Json }).exposure);

    const { error } = await context.supabase
      .from("vendor_portal_memberships")
      .update({ exposure: data.exposure as unknown as Json })
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;

    const b = before as { vendor_id: string; email: string };
    const diff = exposureDiff(prev, data.exposure);
    await writePortalEvent(context, b.vendor_id, companyId, "vendor_portal.exposure_updated", {
      email: b.email,
      changed: diff,
    });
    await writeAuditLog(context, "vendor_portal.exposure_updated", data.id, {
      vendor_id: b.vendor_id,
      email: b.email,
      before: prev,
      after: data.exposure,
      changed: diff,
    });
    return { ok: true };
  });

const acknowledgeInput = z.object({
  vendorId: z.string().uuid(),
  poId: z.string().uuid(),
  decision: z.enum(["accepted", "accepted_with_comments", "rejected"]),
  comment: z.string().trim().max(2000).optional(),
});

export const acknowledgePo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => acknowledgeInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);

    if (
      (data.decision === "rejected" || data.decision === "accepted_with_comments") &&
      !(data.comment ?? "").trim()
    ) {
      throw httpError("comment_required", 400);
    }

    const { error } = await context.supabase.rpc("vendor_portal_acknowledge_po", {
      p_po_id: data.poId,
      p_decision: data.decision,
      p_comment: data.comment,
    });
    if (error) throw httpError(error.message, 403);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// P-224 — vendor-proposed delivery windows
// ---------------------------------------------------------------------------

export interface VendorLineEtaRow {
  po_id: string;
  po_line_no: number | null;
  item_description: string;
  site_need_date: string | null;
  current_eta: string | null;
  eta_confirmed: boolean;
  status: string;
  notes: string | null;
  updated_at: string | null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const proposeDeliveryInput = z.object({
  vendorId: z.string().uuid(),
  poId: z.string().uuid(),
  poIssueDate: isoDate.nullable().optional(),
  lines: z
    .array(
      z.object({
        line_no: z.number().int().min(1).max(9999),
        proposed_date: isoDate,
        proposed_qty: z.number().nonnegative().nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1, "lines_required")
    .max(200),
});

export type ProposeDeliveryInput = z.infer<typeof proposeDeliveryInput>;

/** Per-line ETA / confirmation state for the vendor's own POs. */
export const getVendorPortalLineEtas = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorLineEtaRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("vendor_portal_get_line_etas", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw httpError(error.message, 403);
    return (rows ?? []) as unknown as VendorLineEtaRow[];
  });

/** Vendor proposes delivery dates per PO line — never confirms them. */
export const proposeDelivery = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => proposeDeliveryInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ updated: number }> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);

    if (data.poIssueDate) {
      for (const l of data.lines) {
        if (l.proposed_date < data.poIssueDate) throw httpError("proposed_date_before_issue", 400);
      }
    }

    const { data: n, error } = await context.supabase.rpc("vendor_portal_propose_delivery", {
      p_po_id: data.poId,
      p_lines: data.lines as unknown as Json,
    });
    if (error) throw httpError(error.message, 403);
    return { updated: Number(n ?? 0) };
  });
