// P-029 — Company settings + branding server functions.
// All mutations require auth; writes require company_admin (enforced by RLS
// via `admins write branding` policy + `companies_update` policy). Every
// mutation writes a corresponding audit_log entry via write_audit_log RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

const LOGO_BUCKET = "documents";
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a #RRGGBB hex color");

async function resolveCompanyId(
  context: AuthContext & { user: NonNullable<AuthContext["user"]> },
): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.company_id) {
    throw Object.assign(new Error("No company"), { statusCode: 400 });
  }
  return data.company_id;
}

export type CompanyDetails = {
  id: string;
  name: string;
  legal_name: string | null;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  plan_tier: string;
};

export type CompanyBranding = {
  company_id: string;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  footer_text: string | null;
  updated_at: string;
};

export type CompanySettings = {
  company: CompanyDetails;
  branding: CompanyBranding | null;
  logoSignedUrl: string | null;
};

export const getCompanySettings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<CompanySettings> => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);

    const { data: company, error: companyErr } = await context.supabase
      .from("companies")
      .select("id, name, legal_name, contact_email, phone, address, plan_tier")
      .eq("id", companyId)
      .single();
    if (companyErr) throw companyErr;

    const { data: branding, error: brandingErr } = await context.supabase
      .from("company_branding")
      .select("company_id, logo_url, primary_color, accent_color, footer_text, updated_at")
      .eq("company_id", companyId)
      .maybeSingle();
    if (brandingErr) throw brandingErr;

    let logoSignedUrl: string | null = null;
    if (branding?.logo_url) {
      const { data: signed } = await context.supabase.storage
        .from(LOGO_BUCKET)
        .createSignedUrl(branding.logo_url, SIGNED_URL_TTL_SECONDS);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    return { company, branding, logoSignedUrl };
  });

const detailsSchema = z.object({
  legal_name: z.string().trim().min(1).max(200),
  contact_email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
});

export const updateCompanyDetails = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => detailsSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);

    const { data: existing, error: fetchErr } = await context.supabase
      .from("companies")
      .select("legal_name, contact_email, phone, address")
      .eq("id", companyId)
      .single();
    if (fetchErr) throw fetchErr;

    const patch = {
      legal_name: data.legal_name,
      contact_email: data.contact_email,
      phone: data.phone ?? null,
      address: data.address ?? null,
    };
    const changed_fields = (Object.keys(patch) as (keyof typeof patch)[]).filter(
      (k) => (existing as Record<string, unknown>)[k] !== patch[k],
    );

    if (changed_fields.length === 0) return { ok: true, changed: 0 };

    const { error: updErr } = await context.supabase
      .from("companies")
      .update(patch)
      .eq("id", companyId);
    if (updErr) throw updErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "company.updated",
      p_entity: "companies",
      p_entity_id: companyId,
      p_metadata: { changed_fields },
    });
    if (auditErr) throw auditErr;

    return { ok: true, changed: changed_fields.length };
  });

const brandingSchema = z.object({
  primary_color: hexColorSchema,
  accent_color: hexColorSchema,
  footer_text: z.string().trim().max(500).nullable().optional(),
});

export const upsertCompanyBranding = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => brandingSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);

    const { data: existing } = await context.supabase
      .from("company_branding")
      .select("primary_color, accent_color, footer_text")
      .eq("company_id", companyId)
      .maybeSingle();

    const patch = {
      company_id: companyId,
      primary_color: data.primary_color,
      accent_color: data.accent_color,
      footer_text: data.footer_text ?? null,
    };
    const changed_fields = (["primary_color", "accent_color", "footer_text"] as const).filter(
      (k) => (existing as Record<string, unknown> | null)?.[k] !== patch[k],
    );

    const { error: upsertErr } = await context.supabase
      .from("company_branding")
      .upsert(patch, { onConflict: "company_id" });
    if (upsertErr) throw upsertErr;

    if (changed_fields.length > 0 || !existing) {
      const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
        p_action: "branding.updated",
        p_entity: "company_branding",
        p_entity_id: companyId,
        p_metadata: { changed_fields },
      });
      if (auditErr) throw auditErr;
    }

    return { ok: true, changed: changed_fields.length };
  });

export const getLogoUploadTarget = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);
    return { bucket: LOGO_BUCKET, path: `${companyId}/branding/logo`, companyId };
  });

const setLogoSchema = z.object({ path: z.string().min(1).max(500) });

export const setCompanyLogo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => setLogoSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);
    const expectedPrefix = `${companyId}/branding/`;
    if (!data.path.startsWith(expectedPrefix)) {
      throw Object.assign(new Error("Invalid logo path"), { statusCode: 400 });
    }

    const { error } = await context.supabase
      .from("company_branding")
      .upsert({ company_id: companyId, logo_url: data.path }, { onConflict: "company_id" });
    if (error) throw error;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "branding.logo_updated",
      p_entity: "company_branding",
      p_entity_id: companyId,
      p_metadata: { path: data.path },
    });
    if (auditErr) throw auditErr;

    const { data: signed } = await context.supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL_SECONDS);
    return { ok: true, signedUrl: signed?.signedUrl ?? null };
  });

export const removeCompanyLogo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await resolveCompanyId(context);

    const { data: branding } = await context.supabase
      .from("company_branding")
      .select("logo_url")
      .eq("company_id", companyId)
      .maybeSingle();

    if (branding?.logo_url) {
      await context.supabase.storage.from(LOGO_BUCKET).remove([branding.logo_url]);
    }

    const { error } = await context.supabase
      .from("company_branding")
      .upsert({ company_id: companyId, logo_url: null }, { onConflict: "company_id" });
    if (error) throw error;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "branding.logo_removed",
      p_entity: "company_branding",
      p_entity_id: companyId,
      p_metadata: {},
    });
    if (auditErr) throw auditErr;

    return { ok: true };
  });
