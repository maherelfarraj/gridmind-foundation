// P-117 — Scheduled reports: list / upsert / delete / send (EmailJS delivery).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

// ---------- shared types ---------------------------------------------------

export const REPORT_TYPES = ["om_monthly", "weekly_field", "quarterly_investor"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const FREQUENCIES = ["weekly", "monthly", "quarterly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type ScheduledReportRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  project_name: string | null;
  name: string;
  report_type: ReportType;
  frequency: Frequency;
  day_of_week: number | null;
  day_of_month: number | null;
  hour_utc: number;
  recipients: string[];
  template_sections: Record<string, boolean>;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: "success" | "error" | "skipped" | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- helpers --------------------------------------------------------

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), { statusCode: status });
}

const WRITE_ROLES = ["company_admin", "project_admin"] as const;

async function assertWriter(ctx: AuthContext): Promise<void> {
  const results = await Promise.all(
    WRITE_ROLES.map((r) => ctx.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  if (!results.some((r) => r.data === true)) httpError(403, "forbidden_role");
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) httpError(400, "no_company");
  return cid as string;
}

// ---------- input schemas --------------------------------------------------

const upsertSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  report_type: z.enum(REPORT_TYPES),
  frequency: z.enum(FREQUENCIES),
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  day_of_month: z.number().int().min(1).max(28).nullable().optional(),
  hour_utc: z.number().int().min(0).max(23).default(9),
  recipients: z.array(z.string().trim().email()).min(1).max(20),
  template_sections: z.record(z.string(), z.boolean()).default({}),
  is_active: z.boolean().default(true),
});

// ---------- list -----------------------------------------------------------

export const listScheduledReports = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledReportRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data, error } = await context.supabase
      .from("scheduled_reports" as never)
      .select(
        "id, company_id, project_id, name, report_type, frequency, day_of_week, day_of_month, hour_utc, recipients, template_sections, is_active, next_run_at, last_run_at, last_run_status, last_run_error, created_at, updated_at, projects:project_id(name)",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return (data ?? []).map((r: any) => ({
      id: r.id,
      company_id: r.company_id,
      project_id: r.project_id,
      project_name: r.projects?.name ?? null,
      name: r.name,
      report_type: r.report_type,
      frequency: r.frequency,
      day_of_week: r.day_of_week,
      day_of_month: r.day_of_month,
      hour_utc: r.hour_utc,
      recipients: r.recipients ?? [],
      template_sections: r.template_sections ?? {},
      is_active: r.is_active,
      next_run_at: r.next_run_at,
      last_run_at: r.last_run_at,
      last_run_status: r.last_run_status,
      last_run_error: r.last_run_error,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  });

// ---------- upsert ---------------------------------------------------------

export const upsertScheduledReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => upsertSchema.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    await assertWriter(context);

    // Validate frequency ↔ day pairing at the app layer too (DB constraint
    // will backstop, but user gets a cleaner error).
    if (data.frequency === "weekly" && data.day_of_week == null) {
      httpError(400, "day_of_week_required");
    }
    if (
      (data.frequency === "monthly" || data.frequency === "quarterly") &&
      data.day_of_month == null
    ) {
      httpError(400, "day_of_month_required");
    }

    // Compute next_run_at server-side via compute_next_run RPC.
    const { data: nextRun, error: nrErr } = await context.supabase.rpc(
      "compute_next_run" as never,
      {
        p_frequency: data.frequency,
        p_day_of_week: data.day_of_week ?? null,
        p_day_of_month: data.day_of_month ?? null,
        p_hour_utc: data.hour_utc,
      } as never,
    );
    if (nrErr) throw nrErr;

    const payload = {
      company_id: companyId,
      project_id: data.project_id ?? null,
      name: data.name,
      report_type: data.report_type,
      frequency: data.frequency,
      day_of_week: data.day_of_week ?? null,
      day_of_month: data.day_of_month ?? null,
      hour_utc: data.hour_utc,
      recipients: data.recipients,
      template_sections: data.template_sections,
      is_active: data.is_active,
      next_run_at: nextRun as unknown as string | null,
      created_by: context.user.id,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("scheduled_reports" as never)
        .update({ ...payload, created_by: undefined } as never)
        .eq("id", data.id)
        .eq("company_id", companyId);
      if (error) throw error;
      return { id: data.id };
    }

    const { data: inserted, error } = await context.supabase
      .from("scheduled_reports" as never)
      .insert(payload as never)
      .select("id")
      .single();
    if (error) throw error;
    return { id: (inserted as { id: string }).id };
  });

// ---------- delete ---------------------------------------------------------

export const deleteScheduledReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    await assertWriter(context);
    const { error } = await context.supabase
      .from("scheduled_reports" as never)
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- send (manual "Send test now" and cron target) -----------------

export type SendResult = {
  ok: boolean;
  reason?: string;
  recipients_ok?: number;
  recipients_failed?: number;
};

export const sendScheduledReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<SendResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    await assertWriter(context);

    // Load schedule + company branding for the PDF.
    const { data: row, error } = await context.supabase
      .from("scheduled_reports" as never)
      .select(
        "id, company_id, project_id, name, report_type, frequency, day_of_week, day_of_month, hour_utc, recipients, template_sections, projects:project_id(name), companies:company_id(name)",
      )
      .eq("id", data.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    const schedule = row as any;

    // EmailJS secrets — read at handler runtime, not module scope.
    const serviceId = process.env.EMAILJS_SERVICE_ID;
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;
    if (!serviceId || !templateId || !publicKey || !privateKey) {
      const outcome = {
        status: "error" as const,
        error:
          "EmailJS not configured — add EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY/PRIVATE_KEY in Secrets",
      };
      await context.supabase
        .from("scheduled_reports" as never)
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: outcome.status,
          last_run_error: outcome.error,
        } as never)
        .eq("id", data.id);
      httpError(400, outcome.error);
    }

    // Build a minimal branded PDF summary. The scheduled-report container is
    // deliberately lightweight — per-report deep aggregation lives with the
    // dedicated report modules (P-092, P-110). This is the delivery envelope.
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const companyName = schedule.companies?.name ?? "GridMind EPC";
    doc.setFontSize(20);
    doc.text(companyName, 40, 60);
    doc.setFontSize(14);
    doc.text(schedule.name, 40, 90);
    doc.setFontSize(11);
    doc.text(`Report type: ${schedule.report_type}`, 40, 120);
    doc.text(`Frequency: ${schedule.frequency}`, 40, 140);
    doc.text(`Project: ${schedule.projects?.name ?? "All projects (company-wide)"}`, 40, 160);
    doc.text(`Generated: ${new Date().toISOString()}`, 40, 180);
    const sections = Object.entries(schedule.template_sections ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (sections.length) {
      doc.text("Sections included:", 40, 210);
      sections.forEach((s, i) => doc.text(`• ${s}`, 60, 230 + i * 18));
    }
    const pdfBase64 = doc.output("datauristring").split(",")[1] ?? "";

    // Deliver one message per recipient (EmailJS is per-send).
    let ok = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const to of schedule.recipients as string[]) {
      try {
        const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey,
            accessToken: privateKey,
            template_params: {
              to_email: to,
              report_name: schedule.name,
              period: schedule.frequency,
              company_name: companyName,
              attachment_base64: pdfBase64,
            },
          }),
        });
        if (!res.ok) {
          failed++;
          lastError = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
        } else {
          ok++;
        }
      } catch (e) {
        failed++;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    // Advance schedule bookkeeping.
    const { data: nextRun } = await context.supabase.rpc(
      "compute_next_run" as never,
      {
        p_frequency: schedule.frequency,
        p_day_of_week: schedule.day_of_week,
        p_day_of_month: schedule.day_of_month,
        p_hour_utc: schedule.hour_utc,
      } as never,
    );
    await context.supabase
      .from("scheduled_reports" as never)
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: failed === 0 ? "success" : "error",
        last_run_error: failed === 0 ? null : lastError,
        next_run_at: nextRun as unknown as string | null,
      } as never)
      .eq("id", data.id);

    return {
      ok: failed === 0,
      recipients_ok: ok,
      recipients_failed: failed,
      reason: lastError ?? undefined,
    };
  });
