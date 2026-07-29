// Invite server functions (P-022). All protected via requireSupabaseAuth
// unless explicitly marked as anonymous.
// RLS + SECURITY DEFINER SQL (create_invite / redeem_invite) enforces
// authorization; server-fn handlers add friendly UX-level pre-flight checks.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { Constants } from "@/integrations/supabase/types";

const appRoleSchema = z.enum(Constants.public.Enums.app_role);
const emailSchema = z.string().trim().toLowerCase().email("Invalid email");
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
  .inputValidator((input: unknown) => z.object({ companyId: uuidSchema }).parse(input))
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
  .inputValidator((input: unknown) => z.object({ companyId: uuidSchema }).parse(input))
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

    const profileMap = new Map<string, { email: string | null; full_name: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
        .returns<Array<{ id: string; email: string | null; full_name: string | null }>>();
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

    const members: CompanyMember[] = Array.from(byUser.entries()).map(([userId, roles]) => {
      const prof = profileMap.get(userId);
      return {
        userId,
        email: prof?.email ?? null,
        fullName: prof?.full_name ?? null,
        roles,
      };
    });

    const adminCount = new Set(rows.filter((r) => r.role === "company_admin").map((r) => r.user_id))
      .size;

    const currentUserRoles = byUser.get(context.user.id) ?? [];
    const isSuperAdmin = rows.some(
      (r) => r.user_id === context.user.id && r.role === "super_admin",
    );
    const isAdmin = currentUserRoles.includes("company_admin") || isSuperAdmin;

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
    const acceptUrl = acceptUrlFor(token);

    // P-269 — outbound notification. Side effect only: a failed send never
    // invalidates the invite that was just created.
    const { notify, recipientLocale } = await import("@/lib/email/dispatch.server");
    await notify({
      event: "client_invite",
      to: data.email,
      companyId: data.companyId,
      entity: "invites",
      actorId: context.user?.id ?? null,
      locale: await recipientLocale(context.supabase, data.email),
      params: { accept_url: acceptUrl, role: data.role },
    });

    return { token, acceptUrl };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: uuidSchema }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: existing, error: readErr } = await context.supabase
      .from("invites")
      .select("company_id, email, role")
      .eq("id", data.inviteId)
      .maybeSingle<{ company_id: string; email: string; role: AppRole }>();
    if (readErr) throw readErr;
    if (!existing) throw new Error("Invite not found");

    const { error } = await context.supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("status", "pending");
    if (error) throw error;

    await context.supabase.rpc("write_audit_log", {
      p_action: "invite.revoked",
      p_entity: "invites",
      p_entity_id: data.inviteId,
      p_metadata: {
        email: existing.email,
        role: existing.role,
        company_id: existing.company_id,
      },
    });
    return { ok: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: uuidSchema }).parse(input))
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

    // Vendor invites MUST carry the vendor linkage, otherwise redemption
    // produces an orphan vendor_viewer with an empty portal.
    let vendorId: string | null = null;
    if (existing.role === "vendor_viewer") {
      const { data: membership } = await context.supabase
        .from("vendor_portal_memberships")
        .select("vendor_id")
        .eq("company_id", existing.company_id)
        .eq("email", existing.email.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ vendor_id: string }>();
      vendorId = membership?.vendor_id ?? null;
      if (!vendorId) {
        throw new Error(
          "This vendor invite has no vendor linkage. Re-issue it from Procurement → Vendors → Portal access.",
        );
      }
    }

    const { data: token, error } = await context.supabase.rpc("create_invite", {
      p_company_id: existing.company_id,
      p_email: existing.email,
      p_role: existing.role,
      ...(vendorId ? { p_vendor_id: vendorId } : {}),
    } as never);
    if (error) throw new Error(error.message);
    if (!token) throw new Error("create_invite returned no token");

    await context.supabase.rpc("write_audit_log", {
      p_action: "invite.resent",
      p_entity: "invites",
      p_entity_id: data.inviteId,
      p_metadata: {
        email: existing.email,
        role: existing.role,
        company_id: existing.company_id,
      },
    });
    return { token, acceptUrl: acceptUrlFor(token) };
  });

export type BulkInviteSkipReason =
  | "no_admin_yet"
  | "already_member"
  | "already_pending"
  | "duplicate";

export type BulkInviteResult = {
  created: Array<{ email: string; role: AppRole; acceptUrl: string }>;
  skipped: Array<{ email: string; role: AppRole; reason: BulkInviteSkipReason }>;
  failed: Array<{ email: string; role: AppRole; error: string }>;
};

const bulkRowSchema = z.object({
  email: emailSchema,
  role: appRoleSchema.refine((r) => r !== "super_admin", {
    message: "super_admin cannot be granted through this UI",
  }),
});

export const bulkCreateInvites = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        companyId: uuidSchema,
        rows: z.array(bulkRowSchema).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BulkInviteResult> => {
    requireSupabaseAuth(context);

    // Defense in depth on top of create_invite's own gate.
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_company_admin", {
      _company_id: data.companyId,
    });
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) {
      throw Object.assign(new Error("Only company admins can bulk invite."), {
        statusCode: 403,
      });
    }

    // De-dupe on (email, role) preserving first occurrence.
    const seen = new Set<string>();
    const skipped: BulkInviteResult["skipped"] = [];
    const deduped: Array<{ email: string; role: AppRole }> = [];
    for (const row of data.rows) {
      const key = `${row.email}::${row.role}`;
      if (seen.has(key)) {
        skipped.push({ email: row.email, role: row.role, reason: "duplicate" });
      } else {
        seen.add(key);
        deduped.push(row);
      }
    }

    // Tenancy: without any company_admin, only company_admin rows are allowed.
    const { count: adminCount, error: countErr } = await context.supabase
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .eq("role", "company_admin");
    if (countErr) throw countErr;

    let survivors = deduped;
    if ((adminCount ?? 0) === 0) {
      const kept: typeof deduped = [];
      for (const r of deduped) {
        if (r.role === "company_admin") kept.push(r);
        else skipped.push({ ...r, reason: "no_admin_yet" });
      }
      survivors = kept;
    }

    // Pre-load existing members + pending invites for the company.
    const [{ data: existingMembers, error: memErr }, { data: pending, error: pendErr }] =
      await Promise.all([
        context.supabase
          .from("profiles")
          .select("email")
          .eq("company_id", data.companyId)
          .returns<Array<{ email: string | null }>>(),
        context.supabase
          .from("invites")
          .select("email")
          .eq("company_id", data.companyId)
          .eq("status", "pending")
          .returns<Array<{ email: string }>>(),
      ]);
    if (memErr) throw memErr;
    if (pendErr) throw pendErr;

    const memberEmails = new Set(
      (existingMembers ?? []).map((p) => (p.email ?? "").toLowerCase()).filter(Boolean),
    );
    const pendingEmails = new Set((pending ?? []).map((p) => p.email.toLowerCase()));

    const created: BulkInviteResult["created"] = [];
    const failed: BulkInviteResult["failed"] = [];
    for (const row of survivors) {
      if (memberEmails.has(row.email)) {
        skipped.push({ ...row, reason: "already_member" });
        continue;
      }
      if (pendingEmails.has(row.email)) {
        skipped.push({ ...row, reason: "already_pending" });
        continue;
      }
      const { data: token, error } = await context.supabase.rpc("create_invite", {
        p_company_id: data.companyId,
        p_email: row.email,
        p_role: row.role,
      });
      if (error || !token) {
        failed.push({
          ...row,
          error: error?.message ?? "create_invite returned no token",
        });
        continue;
      }
      // Prevent later rows in the same batch from re-inviting.
      pendingEmails.add(row.email);
      created.push({ ...row, acceptUrl: acceptUrlFor(token) });
    }

    if (created.length > 0) {
      await context.supabase.rpc("write_audit_log", {
        p_action: "invite.bulk_sent",
        p_entity: "invites",
        p_entity_id: null as unknown as string,
        p_metadata: {
          company_id: data.companyId,
          count: created.length,
          roles: Array.from(new Set(created.map((r) => r.role))),
        },
      });
    }

    return { created, skipped, failed };
  });

export const redeemInviteRpc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: companyId, error } = await context.supabase.rpc("redeem_invite", {
      p_token: data.token,
    });
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data, context }): Promise<PeekInviteResult> => {
    requireSupabaseAuth(context);
    const { invite, supabaseAdmin } = await readInviteSafely(data.token);

    if (!invite) return { status: "invalid" };
    if (invite.status === "revoked") return { status: "revoked" };
    if (invite.status === "expired") return { status: "expired" };
    if (invite.status !== "pending") return { status: "invalid" };
    if (new Date(invite.expires_at).getTime() <= Date.now()) return { status: "expired" };

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
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }): Promise<AnonPeekResult> => {
    const { invite, supabaseAdmin } = await readInviteSafely(data.token);

    if (!invite) return { status: "invalid" };
    if (invite.status === "revoked") return { status: "revoked" };
    if (invite.status === "expired") return { status: "expired" };
    if (invite.status !== "pending") return { status: "invalid" };
    if (new Date(invite.expires_at).getTime() <= Date.now()) return { status: "expired" };

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
