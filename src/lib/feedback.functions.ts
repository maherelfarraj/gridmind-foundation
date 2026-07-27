// Bug bash / UAT feedback capture — ops_feedback table. Read/list is
// super-admin only; submission is available to any authenticated user so
// testers can log issues during UAT.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { Database } from "@/integrations/supabase/types";

export type OpsFeedbackCategory = Database["public"]["Enums"]["ops_feedback_category"];
export type OpsFeedbackStatus = Database["public"]["Enums"]["ops_feedback_status"];
export type OpsAlertSeverity = Database["public"]["Enums"]["ops_alert_severity"];

export type OpsFeedbackRow = {
  id: string;
  category: OpsFeedbackCategory;
  severity: OpsAlertSeverity;
  status: OpsFeedbackStatus;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORIES = ["bug", "ux", "performance", "security", "feature", "other"] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;
const STATUSES = ["open", "triaged", "in_progress", "resolved", "closed"] as const;

async function requireSuperAdmin(context: {
  user: { id: string };
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
}) {
  const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
    p_user_id: context.user.id,
    p_role: "super_admin",
  });
  if (roleErr) throw roleErr as Error;
  if (isSuper !== true) {
    throw Object.assign(new Error("forbidden"), {
      statusCode: 403,
      body: JSON.stringify({ error: "forbidden" }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

export const getOpsFeedback = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<OpsFeedbackRow[]> => {
    requireSupabaseAuth(context);
    await requireSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ops_feedback")
      .select(
        "id, category, severity, status, title, description, screenshot_url, created_by, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as OpsFeedbackRow[];
  });

const submitFeedbackSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  screenshot_url: z.string().trim().url().max(1000).optional().nullable(),
});

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => submitFeedbackSchema.parse(input))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve the user's company (best-effort — feedback stays visible to
    // super_admin regardless of company scoping).
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.user.id)
      .maybeSingle();

    const { data: inserted, error } = await supabaseAdmin
      .from("ops_feedback")
      .insert({
        category: data.category,
        severity: data.severity,
        title: data.title,
        description: data.description ?? null,
        screenshot_url: data.screenshot_url ?? null,
        created_by: context.user.id,
        company_id: (profile as { company_id?: string } | null)?.company_id ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: inserted.id };
  });

const updateFeedbackStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
});

export const updateFeedbackStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateFeedbackStatusSchema.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await requireSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ops_feedback")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
