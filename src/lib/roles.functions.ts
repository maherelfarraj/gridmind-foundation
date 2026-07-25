// Company user & role management (P-024). All fns run server-side with
// requireSupabaseAuth. The DB function assert_can_grant_role is called
// first for every grant/revoke — defense in depth, so even a buggy caller
// path hits the authorization check.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { Constants } from "@/integrations/supabase/types";
import type { AppRole, GrantableRole } from "@/lib/role-groups";

const uuidSchema = z.string().uuid();
const grantableRoleSchema = z
  .enum(Constants.public.Enums.app_role)
  .refine((r) => r !== "super_admin", {
    message: "super_admin cannot be granted through this UI",
  }) as z.ZodType<GrantableRole>;

export type CompanyMemberRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  roles: AppRole[];
};

export type CompanyMembersResult = {
  isAdmin: boolean;
  adminCount: number;
  members: CompanyMemberRow[];
};

export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: uuidSchema }).parse(input))
  .handler(async ({ data, context }): Promise<CompanyMembersResult> => {
    requireSupabaseAuth(context);

    const { data: profiles, error: profErr } = await context.supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .eq("company_id", data.companyId)
      .returns<
        Array<{
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
        }>
      >();
    if (profErr) throw profErr;

    const rowsByUser = new Map<string, CompanyMemberRow>();
    for (const p of profiles ?? []) {
      rowsByUser.set(p.id, {
        userId: p.id,
        email: p.email,
        fullName: p.full_name,
        avatarUrl: p.avatar_url,
        roles: [],
      });
    }

    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", data.companyId)
      .returns<Array<{ user_id: string; role: AppRole }>>();
    if (roleErr) throw roleErr;

    let adminCount = 0;
    const adminSet = new Set<string>();
    for (const r of roles ?? []) {
      // A user_role may exist for a user whose profile is in another
      // company (super_admin cross-company). Only surface rows we can
      // render — RLS already filtered the profile list.
      const row = rowsByUser.get(r.user_id);
      if (row) row.roles.push(r.role);
      if (r.role === "company_admin") adminSet.add(r.user_id);
    }
    adminCount = adminSet.size;

    const members = Array.from(rowsByUser.values()).sort((a, b) =>
      (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? ""),
    );

    const selfRoles =
      (roles ?? []).filter((r) => r.user_id === context.user.id).map((r) => r.role) ?? [];
    const isAdmin = selfRoles.includes("company_admin") || selfRoles.includes("super_admin");

    return { isAdmin, adminCount, members };
  });

async function callAssertCanGrantRole(
  context: { supabase: import("@supabase/supabase-js").SupabaseClient },
  companyId: string,
  targetUserId: string,
  role: GrantableRole,
) {
  const { error } = await context.supabase.rpc("assert_can_grant_role", {
    p_target_user_id: targetUserId,
    p_company_id: companyId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

const mutationSchema = z.object({
  companyId: uuidSchema,
  targetUserId: uuidSchema,
  role: grantableRoleSchema,
});

export const grantRole = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await callAssertCanGrantRole(
      { supabase: context.supabase },
      data.companyId,
      data.targetUserId,
      data.role,
    );

    const { error } = await context.supabase.from("user_roles").upsert(
      {
        user_id: data.targetUserId,
        company_id: data.companyId,
        role: data.role,
      },
      { onConflict: "user_id,company_id,role", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "role.granted",
      p_entity: "user_roles",
      p_entity_id: data.targetUserId,
      p_metadata: {
        target_user: data.targetUserId,
        role: data.role,
        company_id: data.companyId,
      },
    });
    if (auditErr) throw new Error(auditErr.message);

    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await callAssertCanGrantRole(
      { supabase: context.supabase },
      data.companyId,
      data.targetUserId,
      data.role,
    );

    if (data.role === "company_admin") {
      const { data: admins, error: adminsErr } = await context.supabase
        .from("user_roles")
        .select("user_id")
        .eq("company_id", data.companyId)
        .eq("role", "company_admin");
      if (adminsErr) throw new Error(adminsErr.message);
      const ids = new Set((admins ?? []).map((r) => r.user_id));
      if (ids.size <= 1 && ids.has(data.targetUserId)) {
        throw Object.assign(new Error("Cannot revoke the last company admin."), {
          statusCode: 409,
          body: JSON.stringify({ error: "last_company_admin" }),
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }

    const { error } = await context.supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("company_id", data.companyId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "role.revoked",
      p_entity: "user_roles",
      p_entity_id: data.targetUserId,
      p_metadata: {
        target_user: data.targetUserId,
        role: data.role,
        company_id: data.companyId,
      },
    });
    if (auditErr) throw new Error(auditErr.message);

    return { ok: true };
  });
