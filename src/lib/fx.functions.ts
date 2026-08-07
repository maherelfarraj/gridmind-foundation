// FX-01 — FX Rate Management server functions. Thin wrapper module.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  fxAlertSettingsSchema,
  fxHttpError,
  fxSettingsSchema,
  hasFxAdminRole,
  loadFxAdminData,
  manualRateSchema,
  type FxAdminData,
} from "@/lib/fx.server";

export type { FxAdminData };

export const getFxAdminData = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<FxAdminData> => {
    requireSupabaseAuth(context);
    return loadFxAdminData(context);
  });

export const syncFxRatesNow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    if (!(await hasFxAdminRole(context))) fxHttpError(403, "forbidden");
    const userId = (context as { user: { id: string } }).user.id;
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
    const { runFxImport } = await import("@/lib/fx/import.server");
    const result = await runFxImport(createServiceRoleClient() as never, {
      trigger: "manual",
      actorKind: "user",
      triggeredBy: userId,
      companyId: (profile?.company_id as string | undefined) ?? null,
    });
    return {
      runId: result.runId,
      status: result.status,
      observationDate: result.observationDate,
      requested: result.requested,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      missing: result.missing,
      durationMs: result.durationMs,
      errorCode: result.errorCode,
      error: result.error,
    };
  });

export const updateFxAlertSettings = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => fxAlertSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasFxAdminRole(context))) fxHttpError(403, "forbidden");
    const userId = (context as { user: { id: string } }).user.id;
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = (profile?.company_id as string | undefined) ?? null;
    if (!companyId) fxHttpError(400, "no_company", "No organization on your profile.");

    const { error } = await (context.supabase as never as { from: (t: string) => any })
      .from("fx_alert_settings")
      .upsert({ company_id: companyId, created_by: userId, ...data }, { onConflict: "company_id" });
    if (error) fxHttpError(400, "alert_settings_write_failed", error.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: "fx.alerts.settings_update",
      p_entity: "fx_alert_settings",
      p_entity_id: null as never,
      p_metadata: data as never,
    });
    return { ok: true };
  });

export const upsertManualFxRate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => manualRateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasFxAdminRole(context))) fxHttpError(403, "forbidden");
    const base = data.base_code.toUpperCase();
    const quote = data.quote_code.toUpperCase();
    if (base === quote) fxHttpError(400, "same_currency", "Base and quote must differ.");
    const { data: row, error } = await (context.supabase as never as { from: (t: string) => any })
      .from("fx_rates")
      .upsert(
        {
          base_code: base,
          quote_code: quote,
          rate: data.rate,
          as_of: data.as_of,
          source: "manual",
          provider: null,
          provider_observed_on: null,
        },
        { onConflict: "base_code,quote_code,as_of,source" },
      )
      .select("id")
      .single();
    if (error) fxHttpError(400, "rate_write_failed", error.message);
    await context.supabase.rpc("write_audit_log", {
      p_action: "fx.rate.manual_upsert",
      p_entity: "fx_rates",
      p_entity_id: row.id as never,
      p_metadata: { ...data, base_code: base, quote_code: quote } as never,
    });
    return { id: row.id as string };
  });

export const updateFxSettings = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => fxSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasFxAdminRole(context))) fxHttpError(403, "forbidden");
    const { error } = await (context.supabase as never as { from: (t: string) => any })
      .from("fx_provider_settings")
      .update({
        enabled: data.enabled,
        base_currency: data.base_currency.toUpperCase(),
        treasury_currencies: data.treasury_currencies.map((c) => c.toUpperCase()),
        schedule_time: data.schedule_time,
        schedule_timezone: data.schedule_timezone,
        staleness_business_days: data.staleness_business_days,
      })
      .eq("id", true);
    if (error) fxHttpError(400, "settings_write_failed", error.message);
    await context.supabase.rpc("write_audit_log", {
      p_action: "fx.settings.update",
      p_entity: "fx_provider_settings",
      p_entity_id: null as never,
      p_metadata: data as never,
    });
    return { ok: true };
  });
