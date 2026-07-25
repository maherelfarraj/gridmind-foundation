// Super Admin tenant management server functions (P-023).
// Every RPC gates on has_role(auth.uid(),'super_admin') server-side.
// Roles live ONLY in public.user_roles; never trust client state.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

const PLAN_TIERS = ["starter", "growth", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

const uuidSchema = z.string().uuid();
const planTierSchema = z.enum(PLAN_TIERS);
const slugSchema = z
  .string()
  .trim()
  .min(1, "Short name is required")
  .max(20, "Short name must be 20 characters or fewer")
  .regex(/^[a-z0-9-]+$/i, "Short name may only contain letters, numbers, and hyphens");
const legalNameSchema = z.string().trim().min(1, "Legal name is required").max(200);
const emailSchema = z.string().trim().toLowerCase().email("Invalid email").max(255);

function forbidden(): never {
  throw Object.assign(new Error("Forbidden"), {
    statusCode: 403,
    body: JSON.stringify({ error: "forbidden" }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function assertSuperAdmin(context: AuthContext & { user: NonNullable<AuthContext["user"]> }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    p_user_id: context.user.id,
    p_role: "super_admin",
  });
  if (error) throw error;
  if (data !== true) forbidden();
}

export type TenantRow = {
  id: string;
  name: string;
  legal_name: string | null;
  contact_email: string | null;
  plan_tier: PlanTier;
  created_at: string;
  member_count: number;
};

export const listTenants = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().trim().max(100).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<TenantRow[]> => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    let query = context.supabase
      .from("companies")
      .select("id, name, legal_name, contact_email, plan_tier, created_at")
      .order("created_at", { ascending: false });

    if (data.search && data.search.length > 0) {
      const pattern = `%${data.search.replace(/[%_]/g, "\\$&")}%`;
      query = query.or(
        `legal_name.ilike.${pattern},name.ilike.${pattern},contact_email.ilike.${pattern}`,
      );
    }

    const { data: companies, error } = await query;
    if (error) throw error;

    const ids = (companies ?? []).map((c) => c.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: profileRows, error: profErr } = await context.supabase
        .from("profiles")
        .select("company_id")
        .in("company_id", ids);
      if (profErr) throw profErr;
      for (const p of profileRows ?? []) {
        if (!p.company_id) continue;
        counts.set(p.company_id, (counts.get(p.company_id) ?? 0) + 1);
      }
    }

    return (companies ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      legal_name: c.legal_name,
      contact_email: c.contact_email,
      plan_tier: c.plan_tier as PlanTier,
      created_at: c.created_at,
      member_count: counts.get(c.id) ?? 0,
    }));
  });

export const createTenant = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        legalName: legalNameSchema,
        slug: slugSchema,
        contactEmail: emailSchema,
        planTier: planTierSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { data: inserted, error } = await context.supabase
      .from("companies")
      .insert({
        name: data.slug,
        slug: data.slug,
        legal_name: data.legalName,
        contact_email: data.contactEmail,
        plan_tier: data.planTier,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw Object.assign(new Error("Short name already in use"), {
          statusCode: 409,
        });
      }
      throw error;
    }

    const { error: auditError } = await context.supabase.rpc("write_audit_log", {
      p_action: "tenant.created",
      p_entity: "companies",
      p_entity_id: inserted.id,
      p_metadata: {
        legal_name: data.legalName,
        slug: data.slug,
        contact_email: data.contactEmail,
        plan_tier: data.planTier,
      },
    });
    if (auditError) throw auditError;

    return { id: inserted.id };
  });

export type TenantDetail = {
  id: string;
  name: string;
  legal_name: string | null;
  contact_email: string | null;
  plan_tier: PlanTier;
  created_at: string;
  member_count: number;
  admin_count: number;
  invite_count: number;
};

export const getTenantDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: uuidSchema }).parse(input))
  .handler(async ({ data, context }): Promise<TenantDetail> => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { data: company, error } = await context.supabase
      .from("companies")
      .select("id, name, legal_name, contact_email, plan_tier, created_at")
      .eq("id", data.companyId)
      .single();
    if (error) throw error;

    const [membersRes, adminsRes, invitesRes] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.companyId),
      context.supabase
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", data.companyId)
        .in("role", ["company_admin", "super_admin"]),
      context.supabase
        .from("invites")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.companyId)
        .eq("status", "pending"),
    ]);
    if (membersRes.error) throw membersRes.error;
    if (adminsRes.error) throw adminsRes.error;
    if (invitesRes.error) throw invitesRes.error;

    return {
      id: company.id,
      name: company.name,
      legal_name: company.legal_name,
      contact_email: company.contact_email,
      plan_tier: company.plan_tier as PlanTier,
      created_at: company.created_at,
      member_count: membersRes.count ?? 0,
      admin_count: adminsRes.count ?? 0,
      invite_count: invitesRes.count ?? 0,
    };
  });

export const updateTenantPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: uuidSchema, planTier: planTierSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { data: current, error: readErr } = await context.supabase
      .from("companies")
      .select("plan_tier")
      .eq("id", data.companyId)
      .single();
    if (readErr) throw readErr;

    const from = current.plan_tier as PlanTier;
    if (from === data.planTier) return { id: data.companyId, changed: false };

    const { error: updErr } = await context.supabase
      .from("companies")
      .update({ plan_tier: data.planTier })
      .eq("id", data.companyId);
    if (updErr) throw updErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "tenant.plan_changed",
      p_entity: "companies",
      p_entity_id: data.companyId,
      p_metadata: { from, to: data.planTier },
    });
    if (auditErr) throw auditErr;

    // Auto-disable green_hydrogen when downgrading away from enterprise.
    // Mirrors has_module_access's hard rule and keeps the override row honest.
    if (from === "enterprise" && data.planTier !== "enterprise") {
      const { error: ghErr } = await context.supabase.from("module_access_rules").upsert(
        {
          company_id: data.companyId,
          module: "green_hydrogen",
          enabled: false,
        },
        { onConflict: "company_id,module" },
      );
      if (ghErr) throw ghErr;

      const { error: ghAuditErr } = await context.supabase.rpc("write_audit_log", {
        p_action: "module_access.auto_disabled",
        p_entity: "module_access_rules",
        p_entity_id: data.companyId,
        p_metadata: {
          module_key: "green_hydrogen",
          from,
          to: data.planTier,
        },
      });
      if (ghAuditErr) throw ghAuditErr;
    }

    return { id: data.companyId, changed: true, from, to: data.planTier };
  });
