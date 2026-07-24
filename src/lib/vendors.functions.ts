// P-061 — Vendor server functions (RLS-scoped, role-gated writes, audited).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

export const VENDOR_STATUSES = [
  "onboarding",
  "active",
  "suspended",
  "blacklisted",
] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const PAYMENT_TERMS = ["net_15", "net_30", "net_45", "net_60"] as const;
export const INCOTERMS = ["DAP", "DDP", "FOB", "CIF", "EXW", "FCA", "CPT"] as const;

export interface Certification {
  name: string;
  issuer: string | null;
  expires_at: string | null;
  file_path: string;
  uploaded_at: string;
}

export interface VendorRow {
  id: string;
  company_id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  currency_code: string | null;
  payment_terms: string | null;
  incoterms: string | null;
  categories: string[];
  certifications: Certification[];
  status: VendorStatus;
  notes: string | null;
  onboarded_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company", "No active company for user.");
  return companyId as string;
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "vendors",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // never fail on audit
  }
}

function toRow(r: any): VendorRow {
  return {
    id: r.id,
    company_id: r.company_id,
    name: r.name,
    legal_name: r.legal_name,
    tax_id: r.tax_id,
    website: r.website,
    email: r.email,
    phone: r.phone,
    address_line: r.address_line,
    city: r.city,
    country: r.country,
    currency_code: r.currency_code,
    payment_terms: r.payment_terms,
    incoterms: r.incoterms,
    categories: (r.categories ?? []) as string[],
    certifications: (r.certifications ?? []) as Certification[],
    status: r.status,
    notes: r.notes,
    onboarded_at: r.onboarded_at,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------
const listInput = z.object({
  search: z.string().nullable().optional(),
  status: z.enum(VENDOR_STATUSES).nullable().optional(),
});

export const listVendors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<VendorRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("vendors")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.or(
        `name.ilike.%${s}%,legal_name.ilike.%${s}%,tax_id.ilike.%${s}%,email.ilike.%${s}%,city.ilike.%${s}%,country.ilike.%${s}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toRow);
  });

export const getVendor = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<VendorRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("vendors")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "vendor_not_found");
    return toRow(row as any);
  });

// ---------------------------------------------------------------------------
// create / update
// ---------------------------------------------------------------------------
const identityShape = {
  name: z.string().trim().min(2).max(160),
  legal_name: z.string().trim().max(200).nullable().optional(),
  tax_id: z.string().trim().max(60).nullable().optional(),
  website: z.string().trim().url().max(300).or(z.literal("")).nullable().optional(),
  email: z.string().trim().email().max(255).or(z.literal("")).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  address_line: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  currency_code: z.string().trim().min(3).max(3).nullable().optional(),
  payment_terms: z.enum(PAYMENT_TERMS).nullable().optional(),
  incoterms: z.enum(INCOTERMS).nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

const createInput = z.object(identityShape);
const updateInput = z.object({
  id: z.string().uuid(),
  patch: z.object(identityShape).partial(),
});

function cleanInput(input: any): Record<string, any> {
  const out: Record<string, any> = { ...input };
  for (const key of Object.keys(out)) {
    if (out[key] === "") out[key] = null;
  }
  return out;
}

export const createVendor = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const insertRow = {
      ...cleanInput(data),
      categories: data.categories ?? [],
      company_id: companyId,
      created_by: (context as any).user.id,
    };
    const { data: inserted, error } = await context.supabase
      .from("vendors")
      .insert(insertRow as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "vendor.create", inserted.id, {
      name: data.name,
      categories: data.categories ?? [],
    });
    return { id: inserted.id };
  });

export const updateVendor = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const patch = cleanInput(data.patch);
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("vendors")
      .update(patch as any)
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "vendor.update", data.id, {
      fields: Object.keys(patch),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// status change
// ---------------------------------------------------------------------------
export const changeVendorStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(VENDOR_STATUSES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: existing, error: exErr } = await context.supabase
      .from("vendors")
      .select("id, status, onboarded_at")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "vendor_not_found");
    const prev = (existing as any).status as VendorStatus;
    if (prev === data.status) return { ok: true };

    const patch: Record<string, any> = { status: data.status };
    if (data.status === "active" && !(existing as any).onboarded_at) {
      patch.onboarded_at = new Date().toISOString();
    }
    const { error } = await context.supabase
      .from("vendors")
      .update(patch as any)
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "vendor.status_change", data.id, {
      from: prev,
      to: data.status,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// certification attach / detach (file itself is uploaded from the browser
// via the request-scoped supabase client — RLS on storage.objects enforces
// the {company_id}/ prefix through storage_company_id()).
// ---------------------------------------------------------------------------
export const attachVendorCertification = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        vendorId: z.string().uuid(),
        certification: z.object({
          name: z.string().trim().min(1).max(160),
          issuer: z.string().trim().max(160).nullable().optional(),
          expires_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
          file_path: z.string().min(1).max(500),
        }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: vendor, error } = await context.supabase
      .from("vendors")
      .select("id, company_id, certifications")
      .eq("id", data.vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!vendor) httpError(404, "vendor_not_found");

    const expectedPrefix = `${(vendor as any).company_id}/vendor-certs/${data.vendorId}/`;
    if (!data.certification.file_path.startsWith(expectedPrefix)) {
      httpError(400, "bad_file_path", `File must live under ${expectedPrefix}`);
    }

    const existing = ((vendor as any).certifications ?? []) as Certification[];
    const entry: Certification = {
      name: data.certification.name,
      issuer: data.certification.issuer ?? null,
      expires_at: data.certification.expires_at ?? null,
      file_path: data.certification.file_path,
      uploaded_at: new Date().toISOString(),
    };
    const { error: upErr } = await context.supabase
      .from("vendors")
      .update({ certifications: [...existing, entry] as any })
      .eq("id", data.vendorId);
    if (upErr) {
      if ((upErr as any).code === "42501") httpError(403, "forbidden");
      throw upErr;
    }
    await audit(context, "vendor.update", data.vendorId, {
      certification_added: entry.name,
    });
    return { ok: true };
  });

export const removeVendorCertification = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        vendorId: z.string().uuid(),
        filePath: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: vendor, error } = await context.supabase
      .from("vendors")
      .select("id, certifications")
      .eq("id", data.vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!vendor) httpError(404, "vendor_not_found");
    const existing = ((vendor as any).certifications ?? []) as Certification[];
    const remaining = existing.filter((c) => c.file_path !== data.filePath);
    const { error: upErr } = await context.supabase
      .from("vendors")
      .update({ certifications: remaining as any })
      .eq("id", data.vendorId);
    if (upErr) {
      if ((upErr as any).code === "42501") httpError(403, "forbidden");
      throw upErr;
    }
    // best-effort storage delete (RLS enforces same tenant)
    try {
      await context.supabase.storage.from("documents").remove([data.filePath]);
    } catch {
      // ignore
    }
    await audit(context, "vendor.update", data.vendorId, {
      certification_removed: data.filePath,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// currencies helper (list active currencies for form select)
// ---------------------------------------------------------------------------
export const listCurrencyCodes = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ code: string; name: string }[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("currencies")
      .select("code, name")
      .order("code");
    if (error) throw error;
    return ((data ?? []) as any[]).map((r) => ({
      code: r.code,
      name: r.name ?? r.code,
    }));
  });

// ---------------------------------------------------------------------------
// role introspection for UI gating
// ---------------------------------------------------------------------------
export const getVendorWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("company_id", companyId)
      .in("role", [
        "procurement_admin",
        "procurement_officer",
        "company_admin",
        "super_admin",
      ] as any)
      .limit(1);
    if (error) throw error;
    return { canWrite: Boolean(data && data.length) };
  });
