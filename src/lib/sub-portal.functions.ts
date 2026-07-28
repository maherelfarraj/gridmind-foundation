// P-259 — Sub portal (external half): server functions.
//
// SECURITY: every subcontractor-facing fn runs `vendorGate` (own membership +
// rate limit) and then calls ONLY the SECURITY DEFINER `sub_portal_*` RPCs,
// which project safe columns (internal-only notes are never returned). The
// subcontract tables themselves are internal-read-only under RLS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { httpError, vendorGate } from "@/lib/vendor-portal.server";
import { SubPortalClaimSchema } from "@/lib/sub-portal.rules";
import {
  isInsideDocPrefix,
  validateUploadFile,
  vendorDocPath,
  VENDOR_DOC_ALLOWED_MIME,
  VENDOR_UPLOAD_MAX_BYTES,
} from "@/lib/vendor-uploads.rules";

const BUCKET = "documents";

// ---------------------------------------------------------------------------
// Types (mirror the jsonb the RPCs project)
// ---------------------------------------------------------------------------

export interface SubPortalSubcontractCard {
  id: string;
  subcontract_number: string | null;
  title: string;
  scope_summary: string | null;
  contract_value: number;
  currency_code: string;
  retention_pct: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
  certified_to_date: number;
  retention_held: number;
  retention_released: number;
  project_name: string | null;
  created_at: string;
}

export interface SubPortalSovRow {
  id: string;
  line_no: number;
  description: string;
  uom: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  certified_pct: number;
  pending_pct: number;
}

export interface SubPortalClaimCard {
  id: string;
  claim_number: string | null;
  period_start: string;
  period_end: string;
  status: string;
  this_period_amount: number;
  gross_to_date: number;
  retention_amount: number;
  net_payable: number;
  submitted_at: string | null;
  certified_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface SubPortalSubcontractDetail {
  subcontract: SubPortalSubcontractCard;
  lines: SubPortalSovRow[];
  claims: SubPortalClaimCard[];
}

export interface SubPortalClaimLineRow {
  id: string;
  subcontract_line_id: string;
  line_no: number;
  description: string;
  uom: string | null;
  line_amount: number;
  previous_pct: number;
  this_period_pct: number;
  cumulative_pct: number;
  previous_amount: number;
  this_period_amount: number;
}

export interface SubPortalClaimMessage {
  id: string;
  author_type: "internal" | "sub";
  body: string;
  created_at: string;
}

export interface SubPortalClaimDetail {
  claim: SubPortalClaimCard & { previous_certified: number; subcontract_id: string };
  subcontract: Pick<
    SubPortalSubcontractCard,
    "id" | "subcontract_number" | "title" | "currency_code" | "retention_pct" | "contract_value"
  >;
  lines: SubPortalClaimLineRow[];
  messages: SubPortalClaimMessage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rpcError(message: string): Error {
  return httpError(message.replace(/^.*?:\s*/, "").trim() || "vendor_portal_error", 403);
}

const vendorIdInput = z.object({ vendorId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listSubPortalSubcontracts = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<SubPortalSubcontractCard[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc("sub_portal_list_subcontracts", {
      p_vendor_id: data.vendorId,
    });
    if (error) throw rpcError(error.message);
    return (rows ?? []) as unknown as SubPortalSubcontractCard[];
  });

export const getSubPortalSubcontract = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput.extend({ subcontractId: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<SubPortalSubcontractDetail> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: payload, error } = await context.supabase.rpc("sub_portal_get_subcontract", {
      p_subcontract_id: data.subcontractId,
    });
    if (error) throw rpcError(error.message);
    return payload as unknown as SubPortalSubcontractDetail;
  });

export const getSubPortalClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.extend({ claimId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<SubPortalClaimDetail> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: payload, error } = await context.supabase.rpc("sub_portal_get_claim", {
      p_claim_id: data.claimId,
    });
    if (error) throw rpcError(error.message);
    return payload as unknown as SubPortalClaimDetail;
  });

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const submitSubPortalClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.merge(SubPortalClaimSchema).parse(raw))
  .handler(async ({ context, data }): Promise<{ claimId: string }> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: payload, error } = await context.supabase.rpc("sub_portal_submit_claim", {
      p_subcontract_id: data.subcontractId,
      p_period_start: data.periodStart,
      p_period_end: data.periodEnd,
      p_lines: data.lines,
      p_note: data.note ?? null,
    });
    if (error) throw rpcError(error.message);
    const out = payload as unknown as { claim_id: string };
    return { claimId: String(out.claim_id) };
  });

export const addSubPortalClaimMessage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({ claimId: z.string().uuid(), body: z.string().trim().min(1).max(4000) })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: id, error } = await context.supabase.rpc("sub_portal_add_claim_message", {
      p_claim_id: data.claimId,
      p_body: data.body,
    });
    if (error) throw rpcError(error.message);
    return { id: String(id) };
  });

// ---------------------------------------------------------------------------
// Compliance documents (feeds P-260)
// ---------------------------------------------------------------------------

export const createSubComplianceUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({
        filename: z.string().min(1).max(300),
        size: z.number().int().nonnegative().max(VENDOR_UPLOAD_MAX_BYTES),
        mimeType: z.string().min(1).max(200),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ path: string; token: string; bucket: string }> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    if (!membership.exposure.documents) throw httpError("documents_not_exposed", 403);
    const bad = validateUploadFile(
      { size: data.size, type: data.mimeType },
      VENDOR_DOC_ALLOWED_MIME,
    );
    if (bad) throw httpError(bad, 400);

    const path = vendorDocPath(membership.company_id, data.vendorId, data.filename);
    const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
    const admin = createServiceRoleClient();
    const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw httpError("upload_url_failed", 400);
    return { path, token: signed.token, bucket: BUCKET };
  });

export const submitSubComplianceDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({
        path: z.string().min(1).max(600),
        title: z.string().trim().min(1).max(200),
        expiresOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ id: string | null }> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    if (!membership.exposure.documents) throw httpError("documents_not_exposed", 403);
    if (!isInsideDocPrefix(data.path, membership.company_id, data.vendorId)) {
      throw httpError("invalid_file_path", 403);
    }
    const name = data.path.slice(data.path.lastIndexOf("/") + 1);
    const { data: id, error } = await context.supabase.rpc("vendor_portal_register_document", {
      p_vendor_id: data.vendorId,
      p_title: data.title,
      p_category: "vendor_compliance",
      p_file_path: data.path,
      p_file_name: name,
      p_expires_on: data.expiresOn ?? null,
    });
    if (error) throw rpcError(error.message);
    return { id: id ? String(id) : null };
  });
