// P-030 — Profile settings server functions.
// Every mutation is scoped to auth.uid() and audited via write_audit_log.
// Roles and email are never mutated here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

const AVATAR_BUCKET = "photos";
const SIGNED_URL_TTL_SECONDS = 300;

export const LOCALES = ["en", "es", "de", "fr", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export const NOTIFICATION_EVENT_KEYS = [
  "approvals",
  "mentions",
  "invites",
  "report_delivery",
  "alarm_escalation",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export type ProfileRow = {
  id: string;
  company_id: string;
  full_name: string | null;
  email: string | null;
  locale: string;
  avatar_url: string | null;
};

export type NotificationPrefsRow = {
  email_enabled: boolean;
  in_app_enabled: boolean;
  prefs: Record<NotificationEventKey, boolean>;
};

export type ProfileSettings = {
  profile: ProfileRow;
  avatarSignedUrl: string | null;
  notificationPrefs: NotificationPrefsRow;
};

const DEFAULT_EVENT_PREFS: Record<NotificationEventKey, boolean> = {
  approvals: true,
  mentions: true,
  invites: true,
  report_delivery: true,
  alarm_escalation: true,
};

function normalizeEventPrefs(raw: unknown): Record<NotificationEventKey, boolean> {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_EVENT_PREFS };
  for (const key of NOTIFICATION_EVENT_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  return out;
}

async function resolveContext(context: AuthContext & { user: NonNullable<AuthContext["user"]> }) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id, company_id, full_name, email, locale, avatar_url")
    .eq("id", context.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  }
  return data as ProfileRow;
}

export const getProfileSettings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileSettings> => {
    requireSupabaseAuth(context);
    const profile = await resolveContext(context);

    let avatarSignedUrl: string | null = null;
    if (profile.avatar_url) {
      const { data: signed } = await context.supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(profile.avatar_url, SIGNED_URL_TTL_SECONDS);
      avatarSignedUrl = signed?.signedUrl ?? null;
    }

    const { data: prefsRow, error: prefsErr } = await context.supabase
      .from("notification_prefs")
      .select("email_enabled, in_app_enabled, prefs")
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (prefsErr) throw prefsErr;

    const notificationPrefs: NotificationPrefsRow = {
      email_enabled: prefsRow?.email_enabled ?? true,
      in_app_enabled: prefsRow?.in_app_enabled ?? true,
      prefs: normalizeEventPrefs(prefsRow?.prefs),
    };

    return { profile, avatarSignedUrl, notificationPrefs };
  });

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(80),
  locale: z.enum(LOCALES),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => profileSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { data: existing, error: fetchErr } = await context.supabase
      .from("profiles")
      .select("full_name, locale")
      .eq("id", context.user.id)
      .single();
    if (fetchErr) throw fetchErr;

    const patch = { full_name: data.full_name, locale: data.locale };
    const changed_fields = (Object.keys(patch) as (keyof typeof patch)[]).filter(
      (k) => (existing as Record<string, unknown>)[k] !== patch[k],
    );

    if (changed_fields.length === 0) return { ok: true, changed: 0 };

    const { error: updErr } = await context.supabase
      .from("profiles")
      .update(patch)
      .eq("id", context.user.id);
    if (updErr) throw updErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "profile.updated",
      p_entity: "profiles",
      p_entity_id: context.user.id,
      p_metadata: { changed_fields },
    });
    if (auditErr) throw auditErr;

    return { ok: true, changed: changed_fields.length };
  });

export const getAvatarUploadTarget = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const profile = await resolveContext(context);
    return {
      bucket: AVATAR_BUCKET,
      path: `${profile.company_id}/avatars/${context.user.id}`,
      companyId: profile.company_id,
    };
  });

const setAvatarSchema = z.object({ path: z.string().min(1).max(500) });

export const setProfileAvatar = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => setAvatarSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const profile = await resolveContext(context);

    const expected = `${profile.company_id}/avatars/${context.user.id}`;
    if (data.path !== expected) {
      throw Object.assign(new Error("Invalid avatar path"), { statusCode: 400 });
    }

    const { error: updErr } = await context.supabase
      .from("profiles")
      .update({ avatar_url: data.path })
      .eq("id", context.user.id);
    if (updErr) throw updErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "profile.updated",
      p_entity: "profiles",
      p_entity_id: context.user.id,
      p_metadata: { changed_fields: ["avatar_url"] },
    });
    if (auditErr) throw auditErr;

    const { data: signed } = await context.supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL_SECONDS);

    return { ok: true, signedUrl: signed?.signedUrl ?? null };
  });

export const removeProfileAvatar = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const profile = await resolveContext(context);

    if (profile.avatar_url) {
      await context.supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_url]);
    }

    const { error: updErr } = await context.supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", context.user.id);
    if (updErr) throw updErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "profile.updated",
      p_entity: "profiles",
      p_entity_id: context.user.id,
      p_metadata: { changed_fields: ["avatar_url"], removed: true },
    });
    if (auditErr) throw auditErr;

    return { ok: true };
  });

const prefsSchema = z.object({
  email_enabled: z.boolean(),
  in_app_enabled: z.boolean(),
  prefs: z.object({
    approvals: z.boolean(),
    mentions: z.boolean(),
    invites: z.boolean(),
    report_delivery: z.boolean(),
    alarm_escalation: z.boolean(),
  }),
});

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => prefsSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { error: upsertErr } = await context.supabase.from("notification_prefs").upsert(
      {
        user_id: context.user.id,
        email_enabled: data.email_enabled,
        in_app_enabled: data.in_app_enabled,
        prefs: data.prefs,
      },
      { onConflict: "user_id" },
    );
    if (upsertErr) throw upsertErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "notification_prefs.updated",
      p_entity: "notification_prefs",
      p_entity_id: context.user.id,
      p_metadata: {
        email_enabled: data.email_enabled,
        in_app_enabled: data.in_app_enabled,
        prefs: data.prefs,
      },
    });
    if (auditErr) throw auditErr;

    return { ok: true };
  });
