// P-102 — SCADA connector + asset server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  computeConnectorKpis,
  connectorConfigSchema,
  createConnectorSchema,
  toggleConnectorSchema,
  updateConnectorSchema,
  upsertAssetsSchema,
  type ConnectorKpis,
} from "@/lib/scada-rules";

// ---- helpers ---------------------------------------------------------------
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
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function assertWriter(context: AuthContext): Promise<void> {
  const roles = ["om_admin", "scada_admin"] as const;
  const results = await Promise.all(
    roles.map((r) =>
      context.supabase.rpc("has_company_role", { p_role: r }),
    ),
  );
  const allowed = results.some((r) => r.data === true);
  if (!allowed) httpError(403, "forbidden_role");
}

async function audit(
  context: AuthContext,
  action: string,
  entity: "scada_connectors" | "scada_assets" | "equipment_registry",
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

// ---- types -----------------------------------------------------------------
type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];

export interface ConnectorRow {
  id: string;
  company_id: string;
  project_id: string;
  project_name: string | null;
  name: string;
  connector_type: string;
  enabled: boolean;
  status: string;
  last_seen_at: string | null;
  last_error: string | null;
  config: Json;
  assets_count: number;
  updated_at: string;
}

export interface ListConnectorsResult {
  rows: ConnectorRow[];
  kpis: ConnectorKpis;
}

// ---- list ------------------------------------------------------------------
export const listScadaConnectors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ListConnectorsResult> => {
    requireSupabaseAuth(context);

    const { data: rows, error } = await context.supabase
      .from("scada_connectors")
      .select(
        "id, company_id, project_id, name, connector_type, enabled, status, last_seen_at, last_error, config, updated_at, projects:projects(name)",
      )
      .eq("company_id", data.companyId)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const ids = (rows ?? []).map((r) => r.id as string);
    const countsById = new Map<string, number>();
    if (ids.length > 0) {
      // scada_assets has no connector FK — count assets scoped to the same
      // project so KPI stays honest even if a connector is deleted later.
      const { data: assetRows } = await context.supabase
        .from("scada_assets")
        .select("project_id")
        .eq("company_id", data.companyId);
      const byProject = new Map<string, number>();
      for (const a of assetRows ?? []) {
        const pid = (a as { project_id: string }).project_id;
        byProject.set(pid, (byProject.get(pid) ?? 0) + 1);
      }
      for (const r of rows ?? []) {
        countsById.set(
          r.id as string,
          byProject.get(r.project_id as string) ?? 0,
        );
      }
    }

    const mapped: ConnectorRow[] = (rows ?? []).map((r) => {
      const proj = (r as { projects: { name: string } | null }).projects;
      return {
        id: r.id as string,
        company_id: r.company_id as string,
        project_id: r.project_id as string,
        project_name: proj?.name ?? null,
        name: r.name as string,
        connector_type: r.connector_type as string,
        enabled: r.enabled as boolean,
        status: r.status as string,
        last_seen_at: (r.last_seen_at as string | null) ?? null,
        last_error: (r.last_error as string | null) ?? null,
        config: (r.config as Json) ?? {},
        assets_count: countsById.get(r.id as string) ?? 0,
        updated_at: r.updated_at as string,
      };
    });

    return { rows: mapped, kpis: computeConnectorKpis(mapped) };
  });

// Lightweight project picker for the wizard.
export const listScadaProjectOptions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", data.companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as { id: string; name: string; code: string | null }[];
  });

// ---- create ----------------------------------------------------------------
export const createScadaConnector = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createConnectorSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);

    // Per-type strict validation of the free-form config bag.
    const configSchema = connectorConfigSchema(data.connector_type);
    const config = configSchema.parse(data.config);

    const { data: proj, error: projErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.project_id)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!proj || (proj as { company_id: string }).company_id !== companyId) {
      httpError(403, "forbidden_project");
    }

    const { data: inserted, error } = await context.supabase
      .from("scada_connectors")
      .insert({
        company_id: companyId,
        project_id: data.project_id,
        name: data.name,
        connector_type: data.connector_type,
        config: config as never,
        created_by: context.user!.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    const id = (inserted as { id: string }).id;
    await audit(context, "scada_connector.create", "scada_connectors", id, {
      project_id: data.project_id,
      connector_type: data.connector_type,
      asset_kind: data.asset_kind,
      name: data.name,
    });
    return { id };
  });

// ---- update ----------------------------------------------------------------
export const updateScadaConnector = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateConnectorSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("scada_connectors")
      .select("id, connector_type")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "not_found");

    const patch: Record<string, unknown> = {};
    if (data.name != null) patch.name = data.name;
    if (data.config != null) {
      const cfgSchema = connectorConfigSchema(
        (existing as { connector_type: string }).connector_type as never,
      );
      patch.config = cfgSchema.parse(data.config) as never;
    }

    const { error } = await context.supabase
      .from("scada_connectors")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw error;

    await audit(context, "scada_connector.update", "scada_connectors", data.id, {
      fields: Object.keys(patch),
    });
    return { ok: true };
  });

// ---- toggle ----------------------------------------------------------------
export const toggleScadaConnector = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => toggleConnectorSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);

    const { error } = await context.supabase
      .from("scada_connectors")
      .update({
        enabled: data.enabled,
        status: data.enabled ? "active" : "disabled",
      })
      .eq("id", data.id);
    if (error) throw error;

    await audit(context, "scada_connector.toggle", "scada_connectors", data.id, {
      enabled: data.enabled,
    });
    return { ok: true };
  });

// ---- upsert assets ---------------------------------------------------------
export const upsertScadaAssets = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => upsertAssetsSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);

    const { data: connector, error: cErr } = await context.supabase
      .from("scada_connectors")
      .select("id, company_id, project_id")
      .eq("id", data.connector_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (
      !connector ||
      (connector as { company_id: string }).company_id !== companyId
    ) {
      httpError(403, "forbidden_connector");
    }
    const projectId = (connector as { project_id: string }).project_id;

    let equipmentCreated = 0;
    let assetsCreated = 0;

    for (const row of data.assets) {
      // 1) upsert equipment_registry by (project_id, tag)
      const { data: eqExisting } = await context.supabase
        .from("equipment_registry")
        .select("id")
        .eq("project_id", projectId)
        .eq("tag", row.equipment.tag)
        .maybeSingle();

      let equipmentId = (eqExisting as { id: string } | null)?.id ?? null;
      if (!equipmentId) {
        const { data: eqIns, error: eqErr } = await context.supabase
          .from("equipment_registry")
          .insert({
            company_id: companyId,
            project_id: projectId,
            tag: row.equipment.tag,
            equipment_type: row.equipment.equipment_type,
            manufacturer: row.equipment.manufacturer ?? null,
            model: row.equipment.model ?? null,
            created_by: context.user!.id,
          })
          .select("id")
          .single();
        if (eqErr) throw eqErr;
        equipmentId = (eqIns as { id: string }).id;
        equipmentCreated += 1;
      }

      // 2) upsert scada_assets by (project_id, asset_key)
      const { data: saExisting } = await context.supabase
        .from("scada_assets")
        .select("id")
        .eq("project_id", projectId)
        .eq("asset_key", row.asset_key)
        .maybeSingle();

      if (saExisting) {
        const { error: uErr } = await context.supabase
          .from("scada_assets")
          .update({
            equipment_id: equipmentId,
            asset_type: row.asset_type,
            name: row.name,
            site_label: row.site_label ?? null,
          })
          .eq("id", (saExisting as { id: string }).id);
        if (uErr) throw uErr;
      } else {
        const { error: iErr } = await context.supabase
          .from("scada_assets")
          .insert({
            company_id: companyId,
            project_id: projectId,
            equipment_id: equipmentId,
            asset_type: row.asset_type,
            asset_key: row.asset_key,
            name: row.name,
            site_label: row.site_label ?? null,
            created_by: context.user!.id,
          });
        if (iErr) throw iErr;
        assetsCreated += 1;
      }
    }

    await audit(context, "scada_asset.upsert", "scada_assets", data.connector_id, {
      connector_id: data.connector_id,
      project_id: projectId,
      count: data.assets.length,
      equipment_created: equipmentCreated,
      assets_created: assetsCreated,
    });
    return { equipmentCreated, assetsCreated };
  });

// ---- test (stub) -----------------------------------------------------------
export const testScadaConnector = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    // Membership check via SELECT — RLS filters by company.
    const { data: row, error } = await context.supabase
      .from("scada_connectors")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    return { ok: null, message: "test pending — wired in B13" } as const;
  });
