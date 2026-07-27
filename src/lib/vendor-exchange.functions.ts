// P-225 — Vendor invoice upload + two-way document exchange server functions.
//
// SECURITY: vendor-facing fns run `vendorGate` (membership + rate limit) and
// then call ONLY the SECURITY DEFINER `vendor_portal_*` RPCs. Storage access
// uses short-lived signed URLs minted server-side (never public URLs), and the
// service-role client is loaded inside handlers, after the caller is verified.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";
import {
  assertVendorPortalAdmin,
  currentCompanyId,
  httpError,
  vendorGate,
} from "@/lib/vendor-portal.server";
import {
  isInsideDocPrefix,
  isInsideInvoicePrefix,
  scanVendorUpload,
  validateUploadFile,
  vendorDocPath,
  vendorInvoicePath,
  VENDOR_DOC_ALLOWED_MIME,
  VENDOR_INVOICE_MIME,
  VENDOR_UPLOAD_MAX_BYTES,
} from "@/lib/vendor-uploads.rules";

const BUCKET = "documents";
const SIGNED_URL_TTL = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorSubmittedInvoiceRow {
  id: string;
  vendor_invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number;
  invoice_currency_code: string;
  status: string;
  invoice_file_path: string | null;
  amount_variance: number | null;
  payment_release_blocked: boolean;
  created_at: string;
  po_number: string | null;
}

export interface VendorExchangeDocRow {
  id: string;
  title: string;
  category: "vendor_submittal" | "vendor_published";
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  actor_type: "vendor" | "internal";
  created_at: string;
}

export interface SignedUploadTarget {
  path: string;
  token: string;
  bucket: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type AdminClient = Awaited<
  ReturnType<typeof import("@/integrations/supabase/admin").createServiceRoleClient>
>;

async function adminClient(): Promise<AdminClient> {
  const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
  return createServiceRoleClient() as AdminClient;
}

/** Read the stored object's real size/mime so a client can't lie about them. */
async function assertStoredObjectOk(
  admin: AdminClient,
  path: string,
  allowedMime: readonly string[],
): Promise<{ size: number; mimeType: string; name: string }> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 1 });
  if (error) throw httpError("upload_not_found", 400);
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) throw httpError("upload_not_found", 400);
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = Number(meta.size ?? 0);
  const mimeType = String(meta.mimetype ?? "");
  if (size > VENDOR_UPLOAD_MAX_BYTES) {
    await admin.storage.from(BUCKET).remove([path]);
    throw httpError("file_too_large", 400);
  }
  if (!allowedMime.includes(mimeType)) {
    await admin.storage.from(BUCKET).remove([path]);
    throw httpError("invalid_mime", 400);
  }
  const scan = await scanVendorUpload({ path, size, mimeType });
  if (!scan.clean) {
    await admin.storage.from(BUCKET).remove([path]);
    throw httpError("quarantined", 400);
  }
  return { size, mimeType, name };
}

function rpcError(message: string): Error {
  return httpError(message.replace(/^.*?:\s*/, "").trim() || "vendor_portal_error", 403);
}

const vendorIdInput = z.object({ vendorId: z.string().uuid() });

const uploadIntent = z.object({
  filename: z.string().min(1).max(300),
  size: z.number().int().nonnegative().max(VENDOR_UPLOAD_MAX_BYTES),
  mimeType: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// Vendor — invoices
// ---------------------------------------------------------------------------

export const createVendorInvoiceUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput.extend({ poId: z.string().uuid() }).merge(uploadIntent).parse(raw),
  )
  .handler(async ({ context, data }): Promise<SignedUploadTarget> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    if (!membership.exposure.invoices) throw httpError("invoices_not_exposed", 403);
    const bad = validateUploadFile({ size: data.size, type: data.mimeType }, [
      VENDOR_INVOICE_MIME,
    ]);
    if (bad) throw httpError(bad, 400);

    const path = vendorInvoicePath(
      membership.company_id,
      data.vendorId,
      data.poId,
      data.filename,
    );
    const admin = await adminClient();
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw httpError("upload_url_failed", 400);
    return { path, token: signed.token, bucket: BUCKET };
  });

export const submitVendorInvoice = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({
        poId: z.string().uuid(),
        path: z.string().min(1).max(600),
        invoiceNumber: z.string().trim().min(1).max(120),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().positive(),
        currency: z.string().trim().min(3).max(3),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ matchId: string }> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    if (!membership.exposure.invoices) throw httpError("invoices_not_exposed", 403);
    if (!isInsideInvoicePrefix(data.path, membership.company_id, data.vendorId, data.poId)) {
      throw httpError("invalid_file_path", 403);
    }

    const admin = await adminClient();
    await assertStoredObjectOk(admin, data.path, [VENDOR_INVOICE_MIME]);

    const { data: matchId, error } = await context.supabase.rpc("vendor_portal_submit_invoice", {
      p_po_id: data.poId,
      p_vendor_invoice_number: data.invoiceNumber,
      p_invoice_date: data.invoiceDate,
      p_invoice_amount: data.amount,
      p_currency: data.currency.toUpperCase(),
      p_file_path: data.path,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([data.path]);
      throw rpcError(error.message);
    }
    return { matchId: String(matchId) };
  });

export const listVendorSubmittedInvoices = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorSubmittedInvoiceRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc(
      "vendor_portal_get_submitted_invoices",
      { p_vendor_id: data.vendorId },
    );
    if (error) throw rpcError(error.message);
    return (rows ?? []) as unknown as VendorSubmittedInvoiceRow[];
  });

/** Short-lived signed download URL, scoped to the caller's own prefixes. */
export const signVendorFileUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput.extend({ path: z.string().min(1).max(600) }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    const invoicePrefix = `${membership.company_id}/vendor-invoices/${data.vendorId}/`;
    const inInvoices =
      data.path.startsWith(invoicePrefix) && !data.path.slice(invoicePrefix.length).includes("..");
    if (!inInvoices && !isInsideDocPrefix(data.path, membership.company_id, data.vendorId)) {
      throw httpError("invalid_file_path", 403);
    }
    const admin = await adminClient();
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (error) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

// ---------------------------------------------------------------------------
// Vendor — document exchange
// ---------------------------------------------------------------------------

export const createVendorDocUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.merge(uploadIntent).parse(raw))
  .handler(async ({ context, data }): Promise<SignedUploadTarget> => {
    requireSupabaseAuth(context);
    const membership = await vendorGate(context, data.vendorId);
    if (!membership.exposure.documents) throw httpError("documents_not_exposed", 403);
    const bad = validateUploadFile(
      { size: data.size, type: data.mimeType },
      VENDOR_DOC_ALLOWED_MIME,
    );
    if (bad) throw httpError(bad, 400);

    const path = vendorDocPath(membership.company_id, data.vendorId, data.filename);
    const admin = await adminClient();
    const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw httpError("upload_url_failed", 400);
    return { path, token: signed.token, bucket: BUCKET };
  });

export const submitVendorDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({
        path: z.string().min(1).max(600),
        title: z.string().trim().min(1).max(200),
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
    const admin = await adminClient();
    const meta = await assertStoredObjectOk(admin, data.path, VENDOR_DOC_ALLOWED_MIME);

    const { data: id, error } = await context.supabase.rpc("vendor_portal_register_document", {
      p_vendor_id: data.vendorId,
      p_title: data.title,
      p_category: "vendor_submittal",
      p_file_path: data.path,
      p_file_name: meta.name,
      p_mime_type: meta.mimeType,
      p_file_size: meta.size,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([data.path]);
      throw rpcError(error.message);
    }
    return { id: id ? String(id) : null };
  });

export const listVendorExchangeDocuments = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorExchangeDocRow[]> => {
    requireSupabaseAuth(context);
    await vendorGate(context, data.vendorId);
    const { data: rows, error } = await context.supabase.rpc(
      "vendor_portal_get_portal_documents",
      { p_vendor_id: data.vendorId },
    );
    if (error) throw rpcError(error.message);
    return (rows ?? []) as unknown as VendorExchangeDocRow[];
  });

// ---------------------------------------------------------------------------
// Internal (EPC) side
// ---------------------------------------------------------------------------

export const listVendorExchangeDocumentsInternal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<VendorExchangeDocRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("vendor_portal_documents")
      .select(
        "id, title, category, storage_path, file_name, mime_type, file_size_bytes, actor_type, created_at",
      )
      .eq("vendor_id", data.vendorId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (rows ?? []) as unknown as VendorExchangeDocRow[];
  });

export const createVendorPublishUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => vendorIdInput.merge(uploadIntent).parse(raw))
  .handler(async ({ context, data }): Promise<SignedUploadTarget> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const bad = validateUploadFile(
      { size: data.size, type: data.mimeType },
      VENDOR_DOC_ALLOWED_MIME,
    );
    if (bad) throw httpError(bad, 400);
    const path = vendorDocPath(companyId, data.vendorId, data.filename);
    const { data: signed, error } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw httpError("upload_url_failed", 400);
    return { path, token: signed.token, bucket: BUCKET };
  });

export const publishVendorDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    vendorIdInput
      .extend({ path: z.string().min(1).max(600), title: z.string().trim().min(1).max(200) })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ id: string | null }> => {
    requireSupabaseAuth(context);
    await assertVendorPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    if (!isInsideDocPrefix(data.path, companyId, data.vendorId)) {
      throw httpError("invalid_file_path", 403);
    }
    const admin = await adminClient();
    const meta = await assertStoredObjectOk(admin, data.path, VENDOR_DOC_ALLOWED_MIME);

    const { data: id, error } = await context.supabase.rpc("vendor_portal_register_document", {
      p_vendor_id: data.vendorId,
      p_title: data.title,
      p_category: "vendor_published",
      p_file_path: data.path,
      p_file_name: meta.name,
      p_mime_type: meta.mimeType,
      p_file_size: meta.size,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([data.path]);
      throw rpcError(error.message);
    }
    return { id: id ? String(id) : null };
  });

export const signVendorFileUrlInternal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ path: z.string().min(1).max(600) }).parse(raw))
  .handler(async ({ context, data }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    if (!data.path.startsWith(`${companyId}/`) || data.path.includes("..")) {
      throw httpError("invalid_file_path", 403);
    }
    const { data: signed, error } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (error) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

export type { Json };
