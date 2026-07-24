// Invite server functions (P-022). All protected via requireSupabaseAuth.
// RLS + SECURITY DEFINER SQL (create_invite / redeem_invite) enforces authorization.
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

function acceptUrlFor(token: string): string {
  const origin = new URL(getRequest().url).origin;
  return `${origin}/accept-invite?token=${token}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const listInvites = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("invites")
      .select(
        "id, email, role, status, expires_at, created_at, invited_by",
      )
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
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
      .maybeSingle();
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
      role: string;
      companyId: string;
      companyName: string;
      expiresAt: string;
    }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "wrong_account"; invitedEmail: string };

export const peekInvite = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: tokenSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PeekInviteResult> => {
    requireSupabaseAuth(context);
    const hash = hashToken(data.token);

    // Privileged narrow read: the invitee is not yet a company member, so
    // company name + invite metadata aren't reachable under their RLS.
    // Callers are already authenticated; we only expose safe fields.
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: invite, error } = await supabaseAdmin
      .from("invites")
      .select(
        "email, role, status, expires_at, company_id, companies!inner(name)",
      )
      .eq("token_hash", hash)
      .maybeSingle();

    if (error) throw error;
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

    const company = invite.companies as unknown as { name: string } | null;
    return {
      status: "valid",
      email: invite.email,
      role: invite.role,
      companyId: invite.company_id,
      companyName: company?.name ?? "your company",
      expiresAt: invite.expires_at,
    };
  });
