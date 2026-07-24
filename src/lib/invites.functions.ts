// Invite server functions (P-022). All protected via requireSupabaseAuth
// unless explicitly marked as anonymous.
// RLS + SECURITY DEFINER SQL (create_invite / redeem_invite) enforces
// authorization; server-fn handlers add friendly UX-level pre-flight checks.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import { Constants } from "@/integrations/supabase/types";

const appRoleSchema = z.enum(Constants.public.Enums.app_role);
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email");
const uuidSchema = z.string().uuid();
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Invalid invite token");

type AppRole = (typeof Constants.public.Enums.app_role)[number];
type InviteStatus = (typeof Constants.public.Enums.invite_status)[number];

function acceptUrlFor(token: string): string {
  const origin = new URL(getRequest().url).origin;
  return `${origin}/accept-invite?token=${token}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InviteListRow = {
  id: string;
  email: string;
  role: AppRole;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
  invited_by: string;
};

export const listInvites = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("invites")
      .select("id, email, role, status, expires_at, created_at, invited_by")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .returns<InviteListRow[]>();
    if (error) throw error;
    return rows ?? [];
  });

export type CompanyMember = {
  userId: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
};

export type CompanyAdminSnapshot = {
  isAdmin: boolean;
  adminCount: number;
  members: CompanyMember[];
};

export const getCompanyAdminSnapshot = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CompanyAdminSnapshot> => {
    requireSupabaseAuth(context);

    const { data: roleRows, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", data.companyId)
      .returns<Array<{ user_id: string; role: AppRole }>>();
    if (roleErr) throw roleErr;

    const rows = roleRows ?? [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

    const profileMap = new Map<
      string,
      { email: string | null; full_name: string | null }
    >();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
        .returns<
          Array<{ id: string; email: string | null; full_name: string | null }>
        >();
      if (profErr) throw profErr;
      for (const p of profiles ?? []) {
        profileMap.set(p.id, { email: p.email, full_name: p.full_name });
      }
    }

    const byUser = new Map<string, AppRole[]>();
    for (const r of rows) {
      const list = byUser.get(r.user_id) ?? [];
      list.push(r.role);
      byUser.set(r.user_id, list);
    }

    const members: CompanyMember[] = Array.from(byUser.entries()).map(
      ([userId, roles]) => {
        const prof = profileMap.get(userId);
        return {
          userId,
          email: prof?.email ?? null,
          fullName: prof?.full_name ?? null,
          roles,
        };
      },
    );

    const adminCount = new Set(
      rows.filter((r) => r.role === "company_admin").map((r) => r.user_id),
    ).size;

    const currentUserRoles = byUser.get(context.user.id) ?? [];
    const isSuperAdmin = rows.some(
      (r) => r.user_id === context.user.id && r.role === "super_admin",
    );
    const isAdmin =
      currentUserRoles.includes("company_admin") || isSuperAdmin;

    return { isAdmin, adminCount, members };
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        companyId: uuidSchema,
        email: emailSchema,
        role: appRoleSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    // UX pre-flight: block chicken-and-egg case with a friendly message.
    // The SQL RPC also enforces "only admins can invite"; this narrows the
    // specific "no company_admin exists yet" scenario.
    const { count: adminCount, error: countErr } = await context.supabase
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .eq("role", "company_admin");
    if (countErr) throw countErr;

    if ((adminCount ?? 0) === 0 && data.role !== "company_admin") {
      throw new Error(
        "The first company admin must be bootstrapped by a super admin. Invite a company_admin first.",
      );
    }

    const { data: token, error } = await context.supabase.rpc("create_invite", {
      p_company_id: data.companyId,
      p_email: data.email,
      p_role: data.role,
    });
    if (error) throw new Error(error.message);
    if (!token) throw new Error("create_invite returned no token");
    return { token, acceptUrl: acceptUrlFor(token) };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ inviteId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { error } = await context.supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("status", "pending");
    if (error) throw error;
    return { ok: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ inviteId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: existing, error: readErr } = await context.supabase
      .from("invites")
      .select("company_id, email, role")
      .eq("id", data.inviteId)
      .maybeSingle<{
        company_id: string;
        email: string;
        role: AppRole;
      }>();
    if (readErr) throw readErr;
    if (!existing) throw new Error("Invite not found");

    await context.supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("status", "pending");

    const { data: token, error } = await context.supabase.rpc("create_invite", {
      p_company_id: existing.company_id,
      p_email: existing.email,
      p_role: existing.role,
    });
    if (error) throw new Error(error.message);
    if (!token) throw new Error("create_invite returned no token");
    return { token, acceptUrl: acceptUrlFor(token) };
  });

export const redeemInviteRpc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: tokenSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: companyId, error } = await context.supabase.rpc(
      "redeem_invite",
      { p_token: data.token },
    );
    if (error) throw new Error(error.message);
    return { companyId };
  });

export type PeekInviteResult =
  | {
      status: "valid";
      email: string;
      role: AppRole;
      companyId: string;
      companyName: string;
      expiresAt: string;
    }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "wrong_account"; invitedEmail: string };

async function readInviteSafely(token: string) {
  const hash = hashToken(token);
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data: invite, error } = await supabaseAdmin
    .from("invites")
    .select("email, role, status, expires_at, company_id")
    .eq("token_hash", hash)
    .maybeSingle<{
      email: string;
      role: AppRole;
      status: InviteStatus;
      expires_at: string;
      company_id: string;
    }>();
  if (error) throw error;
  return { invite, supabaseAdmin };
}

export const peekInvite = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: tokenSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PeekInviteResult> => {
    requireSupabaseAuth(context);
    const { invite, supabaseAdmin } = await readInviteSafely(data.token);

    if (!invite) return { status: "invalid" };
    if (invite.status === "revoked") return { status: "revoked" };
    if (invite.status === "expired") return { status: "expired" };
    if (invite.status !== "pending") return { status: "invalid" };
    if (new Date(invite.expires_at).getTime() <= Date.now())
      return { status: "expired" };

    const callerEmail = (context.user.email ?? "").toLowerCase();
    if (callerEmail !== invite.email.toLowerCase()) {
      return { status: "wrong_account", invitedEmail: invite.email };
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", invite.company_id)
      .maybeSingle<{ name: string }>();

    return {
      status: "valid",
      email: invite.email,
      role: invite.role,
      companyId: invite.company_id,
      companyName: company?.name ?? "your company",
      expiresAt: invite.expires_at,
    };
  });

// Anonymous peek — used before the invitee has an auth session so they can
// see who invited them and choose "set password" vs "Continue with Google".
// Returns only safe fields: invitee email (already in the link's token), role,
// company name, and invite state. No PII beyond the invitee's own address.
export type AnonPeekResult = Exclude<PeekInviteResult, { status: "wrong_account" }>;

export const peekInviteAnonymous = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ token: tokenSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<AnonPeekResult> => {
    const { invite, supabaseAdmin } = await readInviteSafely(data.token);

    if (!invite) return { status: "invalid" };
    if (invite.status === "revoked") return { status: "revoked" };
    if (invite.status === "expired") return { status: "expired" };
    if (invite.status !== "pending") return { status: "invalid" };
    if (new Date(invite.expires_at).getTime() <= Date.now())
      return { status: "expired" };

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", invite.company_id)
      .maybeSingle<{ name: string }>();

    return {
      status: "valid",
      email: invite.email,
      role: invite.role,
      companyId: invite.company_id,
      companyName: company?.name ?? "your company",
      expiresAt: invite.expires_at,
    };
  });
