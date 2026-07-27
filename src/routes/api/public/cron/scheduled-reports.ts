/**
 * P-123 — Scheduled reports delivery cron.
 *
 * Selects `is_active AND next_run_at <= now()` rows from scheduled_reports
 * and delivers each via the same EmailJS pipeline as
 * sendScheduledReport (P-117). Failures set last_run_error and the loop
 * continues to the next schedule — one bad recipient must not stall the
 * queue. Successful delivery advances next_run_at via compute_next_run.
 *
 * pg_cron registration:
 *   select cron.schedule(
 *     'cron-scheduled-reports', '*\/15 * * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/public/cron/scheduled-reports',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:scheduled-reports";
const MAX_PER_RUN = 50;

async function renderPdfBase64(schedule: {
  name: string;
  report_type: string;
  frequency: string;
  template_sections: Record<string, unknown> | null;
  companies: { name?: string } | null;
  projects: { name?: string } | null;
}): Promise<string> {
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
  return doc.output("datauristring").split(",")[1] ?? "";
}

export const Route = createFileRoute("/api/public/cron/scheduled-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ROUTE,
          allowCron: true,
          rateCapacity: 4,
          rateRefillPerSec: 0.02,
        });
        if (!guard.ok) return guard.response;
        if (guard.caller.kind !== "cron") {
          return Response.json({ error: "cron_only" }, { status: 403 });
        }

        const admin = createServiceRoleClient();

        const __auditStartedAt = Date.now();
        const __scheduledAt = new Date().toISOString();
        await admin.from("audit_logs").insert({
          company_id: null,
          actor_id: null,
          action: "cron.scheduled_reports.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
            const nowIso = new Date().toISOString();
            const due = await admin
              .from("scheduled_reports")
              .select(
                "id, company_id, project_id, name, report_type, frequency, day_of_week, day_of_month, hour_utc, recipients, template_sections, projects:project_id(name), companies:company_id(name)",
              )
              .eq("is_active", true)
              .lte("next_run_at", nowIso)
              .order("next_run_at", { ascending: true })
              .limit(MAX_PER_RUN);

            if (due.error && (due.error as { code?: string }).code === "42P01") {
              return Response.json(
                { skipped: true, reason: "scheduled_reports_missing" },
                { status: 200 },
              );
            }
            if (due.error) {
              return Response.json(
                { error: "query_failed", message: due.error.message },
                { status: 500 },
              );
            }

            const serviceId = process.env.EMAILJS_SERVICE_ID;
            const templateId = process.env.EMAILJS_TEMPLATE_ID;
            const publicKey = process.env.EMAILJS_PUBLIC_KEY;
            const privateKey = process.env.EMAILJS_PRIVATE_KEY;
            const emailjsReady = !!(serviceId && templateId && publicKey && privateKey);

            type Counts = {
              sent: number;
              failed: number;
              recipients_ok: number;
              recipients_failed: number;
            };
            const perCompany = new Map<string, Counts>();
            const bump = (c: string, patch: Partial<Counts>) => {
              const cur = perCompany.get(c) ?? {
                sent: 0,
                failed: 0,
                recipients_ok: 0,
                recipients_failed: 0,
              };
              perCompany.set(c, {
                sent: cur.sent + (patch.sent ?? 0),
                failed: cur.failed + (patch.failed ?? 0),
                recipients_ok: cur.recipients_ok + (patch.recipients_ok ?? 0),
                recipients_failed: cur.recipients_failed + (patch.recipients_failed ?? 0),
              });
            };

            for (const row of (due.data ?? []) as Array<Record<string, unknown>>) {
              const schedule = row as unknown as {
                id: string;
                company_id: string;
                frequency: string;
                day_of_week: number | null;
                day_of_month: number | null;
                hour_utc: number | null;
                recipients: string[];
                name: string;
                report_type: string;
                template_sections: Record<string, unknown> | null;
                projects: { name?: string } | null;
                companies: { name?: string } | null;
              };

              if (!emailjsReady) {
                await admin
                  .from("scheduled_reports")
                  .update({
                    last_run_at: nowIso,
                    last_run_status: "error",
                    last_run_error: "emailjs_not_configured",
                  } as never)
                  .eq("id", schedule.id);
                bump(schedule.company_id, { failed: 1 });
                continue;
              }

              let recipientsOk = 0;
              let recipientsFailed = 0;
              let lastError: string | null = null;
              try {
                const pdfBase64 = await renderPdfBase64(schedule);
                for (const to of schedule.recipients ?? []) {
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
                          company_name: schedule.companies?.name ?? "GridMind EPC",
                          attachment_base64: pdfBase64,
                        },
                      }),
                    });
                    if (!res.ok) {
                      recipientsFailed++;
                      lastError = `HTTP ${res.status}`;
                    } else {
                      recipientsOk++;
                    }
                  } catch (e) {
                    recipientsFailed++;
                    lastError = e instanceof Error ? e.message : String(e);
                  }
                }
              } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                recipientsFailed = (schedule.recipients ?? []).length;
              }

              const success = recipientsFailed === 0 && recipientsOk > 0;
              const { data: nextRun } = await admin.rpc("compute_next_run", {
                p_frequency: schedule.frequency,
                p_day_of_week: schedule.day_of_week,
                p_day_of_month: schedule.day_of_month,
                p_hour_utc: schedule.hour_utc,
              } as never);
              await admin
                .from("scheduled_reports")
                .update({
                  last_run_at: nowIso,
                  last_run_status: success ? "success" : "error",
                  last_run_error: success ? null : lastError,
                  next_run_at: (nextRun as unknown as string | null) ?? null,
                } as never)
                .eq("id", schedule.id);

              bump(schedule.company_id, {
                sent: success ? 1 : 0,
                failed: success ? 0 : 1,
                recipients_ok: recipientsOk,
                recipients_failed: recipientsFailed,
              });
            }

            // Per-company summary audit rows.
            for (const [companyId, counts] of perCompany) {
              await admin.from("audit_logs").insert({
                company_id: companyId,
                actor_id: null,
                action: "cron.scheduled_reports",
                entity: "cron",
                entity_id: null,
                metadata: {
                  route: ROUTE,
                  emailjs_configured: emailjsReady,
                  ...counts,
                },
              } as never);
            }

            return Response.json({
              processed: (due.data ?? []).length,
              companies_affected: perCompany.size,
              emailjs_configured: emailjsReady,
            });
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.scheduled_reports.success",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              result_summary: { status: __result.status },
            },
          } as never);
          return __result;
        } catch (__err) {
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.scheduled_reports.failure",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              error_message: __err instanceof Error ? __err.message : String(__err),
            },
          } as never);
          throw __err;
        }
      },
    },
  },
});
