// P-070 — Material price alert server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  alertSubscriptionSchema,
  computeChangePct,
  priceObservationSchema,
  shouldTrigger,
  type MaterialCategory,
} from "@/lib/procurement-extras-rules";

// ---------------------------------------------------------------------------
// row shape
// ---------------------------------------------------------------------------
export interface PriceAlertRow {
  id: string;
  company_id: string;
  category: MaterialCategory;
  region: string;
  unit: string;
  index_price: number | null;
  currency_code: string;
  previous_price: number | null;
  change_pct: number | null;
  alert_threshold_pct: number;
  triggered: boolean;
  triggered_at: string | null;
  source: string | null;
  observed_at: string;
  created_at: string;
  updated_at: string;
}

const WRITE_ROLES = [
  "procurement_admin",
  "procurement_officer",
  "company_admin",
] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function hasAnyWriteRole(context: AuthContext): Promise<boolean> {
  const results = await Promise.all(
    WRITE_ROLES.map((r) =>
      context.supabase.rpc("has_company_role", { p_role: r as any }),
    ),
  );
  return results.some((r) => Boolean(r?.data));
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "material_price_alerts",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toRow(r: any): PriceAlertRow {
  return {
    id: r.id,
    company_id: r.company_id,
    category: r.category,
    region: r.region,
    unit: r.unit,
    index_price: r.index_price == null ? null : Number(r.index_price),
    currency_code: r.currency_code,
    previous_price: r.previous_price == null ? null : Number(r.previous_price),
    change_pct: r.change_pct == null ? null : Number(r.change_pct),
    alert_threshold_pct: Number(r.alert_threshold_pct),
    triggered: !!r.triggered,
    triggered_at: r.triggered_at,
    source: r.source,
    observed_at: r.observed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getPriceAlertAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyWriteRole(context) };
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
export const listPriceAlerts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PriceAlertRow[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("material_price_alerts")
      .select("*")
      .order("triggered", { ascending: false })
      .order("category", { ascending: true })
      .order("region", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as any[]).map(toRow);
  });

// ---------------------------------------------------------------------------
// upsert subscription
// ---------------------------------------------------------------------------
export const upsertPriceAlertSubscription = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => alertSubscriptionSchema.parse(input))
  .handler(async ({ data, context }): Promise<PriceAlertRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);

    const payload = {
      company_id: companyId,
      category: data.category,
      region: data.region,
      unit: data.unit,
      currency_code: data.currency_code,
      alert_threshold_pct: data.alert_threshold_pct,
      source: data.source ?? null,
      created_by: (context as any).user.id,
    };

    const { data: row, error } = await context.supabase
      .from("material_price_alerts")
      .upsert(payload as any, { onConflict: "company_id,category,region" })
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "price_alert.subscribe", (row as any).id, {
      category: data.category,
      region: data.region,
      threshold: data.alert_threshold_pct,
    });
    return toRow(row);
  });

// ---------------------------------------------------------------------------
// record observation
// ---------------------------------------------------------------------------
export const recordPriceObservation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => priceObservationSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ row: PriceAlertRow; changePct: number | null; triggered: boolean }> => {
      requireSupabaseAuth(context);
      if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");

      const { data: current, error: rErr } = await context.supabase
        .from("material_price_alerts")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!current) httpError(404, "alert_not_found");

      const previous =
        (current as any).index_price == null
          ? null
          : Number((current as any).index_price);
      const changePct = computeChangePct(previous, data.index_price);
      const threshold = Number((current as any).alert_threshold_pct);
      const triggered = shouldTrigger(changePct, threshold);

      const patch: Record<string, unknown> = {
        previous_price: previous,
        index_price: data.index_price,
        change_pct: changePct,
        observed_at: data.observed_at ?? new Date().toISOString().slice(0, 10),
        source: data.source ?? (current as any).source ?? null,
      };
      if (triggered) {
        patch.triggered = true;
        patch.triggered_at = new Date().toISOString();
      }

      const { data: updated, error } = await context.supabase
        .from("material_price_alerts")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }

      await audit(context, "price_alert.observe", data.id, {
        previous,
        index_price: data.index_price,
        change_pct: changePct,
        triggered,
      });

      return { row: toRow(updated), changePct, triggered };
    },
  );

// ---------------------------------------------------------------------------
// acknowledge
// ---------------------------------------------------------------------------
export const acknowledgePriceAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PriceAlertRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");
    const { data: row, error } = await context.supabase
      .from("material_price_alerts")
      .update({ triggered: false, triggered_at: null } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "price_alert.acknowledge", data.id, {});
    return toRow(row);
  });

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
export const deletePriceAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");
    const { error } = await context.supabase
      .from("material_price_alerts")
      .delete()
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "price_alert.delete", data.id, {});
    return { ok: true };
  });
