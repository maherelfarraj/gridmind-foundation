/**
 * P-172 — Server-side helpers for SCADA ingestion (mappings, historian import,
 * ingestion health). Kept out of *.functions.ts so the server-fn split
 * transform cannot drop module-scope helpers.
 */
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  classifyConnectorHealth,
  parseHistorianCsv,
  summarizeIngestionHealth,
  type ConnectorHealth,
  type IngestionHealthKpis,
  type TagMappingInput,
} from "@/lib/scada/ingestion";

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(context: AuthContext): Promise<string> {
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

export async function assertIngestionWriter(context: AuthContext): Promise<void> {
  const roles = ["om_admin", "scada_admin", "company_admin"] as const;
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r })),
  );
  if (!results.some((r) => r.data === true)) httpError(403, "forbidden_role");
}

export interface TagMappingRow {
  id: string;
  project_id: string;
  project_name: string | null;
  connector_id: string | null;
  connector_name: string | null;
  tag_dictionary_id: string;
  tag: string | null;
  unit: string | null;
  protocol: string;
  source_address: string;
  data_type: string;
  byte_order: string;
  scaling_factor: number;
  scaling_offset: number;
  poll_interval_s: number;
  enabled: boolean;
  updated_at: string;
}

export async function listMappings(
  context: AuthContext,
  companyId: string,
): Promise<TagMappingRow[]> {
  const { data, error } = await context.supabase
    .from("tag_mappings")
    .select(
      "id, project_id, connector_id, tag_dictionary_id, protocol, source_address, data_type, byte_order, scaling_factor, scaling_offset, poll_interval_s, enabled, updated_at, projects:projects(name), scada_connectors:scada_connectors(name), tag_dictionary:tag_dictionary(tag, unit)",
    )
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const proj = row.projects as { name: string } | null;
    const conn = row.scada_connectors as { name: string } | null;
    const tag = row.tag_dictionary as { tag: string; unit: string | null } | null;
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      project_name: proj?.name ?? null,
      connector_id: (row.connector_id as string | null) ?? null,
      connector_name: conn?.name ?? null,
      tag_dictionary_id: row.tag_dictionary_id as string,
      tag: tag?.tag ?? null,
      unit: tag?.unit ?? null,
      protocol: row.protocol as string,
      source_address: row.source_address as string,
      data_type: row.data_type as string,
      byte_order: row.byte_order as string,
      scaling_factor: Number(row.scaling_factor ?? 1),
      scaling_offset: Number(row.scaling_offset ?? 0),
      poll_interval_s: Number(row.poll_interval_s ?? 60),
      enabled: Boolean(row.enabled),
      updated_at: row.updated_at as string,
    };
  });
}

export async function saveMapping(
  context: AuthContext,
  companyId: string,
  input: TagMappingInput,
): Promise<{ id: string }> {
  const payload = {
    company_id: companyId,
    project_id: input.project_id,
    connector_id: input.connector_id ?? null,
    tag_dictionary_id: input.tag_dictionary_id,
    protocol: input.protocol,
    source_address: input.source_address.trim(),
    data_type: input.data_type,
    byte_order: input.byte_order,
    scaling_factor: input.scaling_factor,
    scaling_offset: input.scaling_offset,
    poll_interval_s: input.poll_interval_s,
    enabled: input.enabled,
  };

  if (input.id) {
    const { error } = await context.supabase
      .from("tag_mappings")
      .update(payload as never)
      .eq("id", input.id)
      .eq("company_id", companyId);
    if (error) throw error;
    return { id: input.id };
  }

  const { data, error } = await context.supabase
    .from("tag_mappings")
    .insert({ ...payload, created_by: context.user!.id } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { id: (data as { id: string }).id };
}

export interface TagOption {
  id: string;
  tag: string;
  unit: string | null;
  project_id: string;
}

export async function listTagOptions(
  context: AuthContext,
  companyId: string,
): Promise<TagOption[]> {
  const { data, error } = await context.supabase
    .from("tag_dictionary")
    .select("id, tag, unit, project_id")
    .eq("company_id", companyId)
    .order("tag", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as TagOption[];
}

// ------------------------------------------------------------ health summary --

export interface IngestionRunRow {
  id: string;
  connector_id: string | null;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_received: number;
  rows_accepted: number;
  rows_rejected: number;
  source_label: string | null;
  error_text: string | null;
}

export interface IngestionHealthPayload {
  connectors: ConnectorHealth[];
  runs: IngestionRunRow[];
  kpis: IngestionHealthKpis;
}

export async function buildIngestionHealth(
  context: AuthContext,
  companyId: string,
): Promise<IngestionHealthPayload> {
  const [{ data: connectorRows, error: cErr }, { data: runRows, error: rErr }, { data: mapRows }] =
    await Promise.all([
      context.supabase
        .from("scada_connectors")
        .select("id, name, connector_type, enabled, last_seen_at, config")
        .eq("company_id", companyId),
      context.supabase
        .from("ingestion_runs")
        .select(
          "id, connector_id, trigger, status, started_at, finished_at, duration_ms, rows_received, rows_accepted, rows_rejected, source_label, error_text",
        )
        .eq("company_id", companyId)
        .order("started_at", { ascending: false })
        .limit(100),
      context.supabase.from("tag_mappings").select("connector_id").eq("company_id", companyId),
    ]);
  if (cErr) throw cErr;
  if (rErr) throw rErr;

  const runs = (runRows ?? []) as IngestionRunRow[];
  const mappingsByConnector = new Map<string, number>();
  for (const m of (mapRows ?? []) as { connector_id: string | null }[]) {
    if (!m.connector_id) continue;
    mappingsByConnector.set(m.connector_id, (mappingsByConnector.get(m.connector_id) ?? 0) + 1);
  }
  const lastRunByConnector = new Map<string, IngestionRunRow>();
  for (const run of runs) {
    if (!run.connector_id) continue;
    if (!lastRunByConnector.has(run.connector_id)) lastRunByConnector.set(run.connector_id, run);
  }

  const connectors = ((connectorRows ?? []) as Record<string, unknown>[]).map((c) => {
    const id = c.id as string;
    const config = (c.config ?? {}) as { poll_interval_s?: number };
    return classifyConnectorHealth({
      connector_id: id,
      name: c.name as string,
      connector_type: c.connector_type as string,
      enabled: Boolean(c.enabled),
      last_seen_at: (c.last_seen_at as string | null) ?? null,
      expected_interval_s: Number(config.poll_interval_s ?? 60),
      mappings_count: mappingsByConnector.get(id) ?? 0,
      lastRun: lastRunByConnector.get(id) ?? null,
    });
  });

  return { connectors, runs, kpis: summarizeIngestionHealth(connectors, runs) };
}

// -------------------------------------------------------------- CSV historian --

export interface HistorianImportResult {
  run_id: string;
  rows_received: number;
  rows_accepted: number;
  rows_rejected: number;
  unmapped_columns: string[];
}

export async function importHistorian(
  context: AuthContext,
  companyId: string,
  args: { project_id: string; connector_id?: string | null; source_label: string; csv: string },
): Promise<HistorianImportResult> {
  const started = Date.now();
  const parsed = parseHistorianCsv(args.csv);

  const { data: runInsert, error: runErr } = await context.supabase
    .from("ingestion_runs")
    .insert({
      company_id: companyId,
      project_id: args.project_id,
      connector_id: args.connector_id ?? null,
      trigger: "import",
      status: "running",
      source_label: args.source_label,
      rows_received: parsed.rowsReceived,
      created_by: context.user!.id,
    } as never)
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = (runInsert as { id: string }).id;

  // Resolve historian column → tag → scada asset via mappings + dictionary.
  const { data: mapRows, error: mErr } = await context.supabase
    .from("tag_mappings")
    .select(
      "source_address, scaling_factor, scaling_offset, tag_dictionary:tag_dictionary(id, metric, asset_node_id)",
    )
    .eq("company_id", companyId)
    .eq("project_id", args.project_id)
    .eq("protocol", "historian_csv")
    .eq("enabled", true);
  if (mErr) throw mErr;

  interface ResolvedMapping {
    metric: string;
    assetNodeId: string | null;
    factor: number;
    offset: number;
  }
  const byColumn = new Map<string, ResolvedMapping>();
  for (const row of (mapRows ?? []) as Record<string, unknown>[]) {
    const tag = row.tag_dictionary as {
      metric: string | null;
      asset_node_id: string | null;
    } | null;
    if (!tag?.metric) continue;
    byColumn.set(row.source_address as string, {
      metric: tag.metric,
      assetNodeId: tag.asset_node_id,
      factor: Number(row.scaling_factor ?? 1),
      offset: Number(row.scaling_offset ?? 0),
    });
  }

  // asset_node → scada_asset for telemetry writes.
  const nodeIds = Array.from(
    new Set(
      Array.from(byColumn.values())
        .map((m) => m.assetNodeId)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const scadaAssetByNode = new Map<string, string>();
  if (nodeIds.length > 0) {
    const { data: nodes } = await context.supabase
      .from("asset_nodes")
      .select("id, scada_asset_id")
      .in("id", nodeIds);
    for (const n of (nodes ?? []) as { id: string; scada_asset_id: string | null }[]) {
      if (n.scada_asset_id) scadaAssetByNode.set(n.id, n.scada_asset_id);
    }
  }

  const unmapped = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const reading of parsed.readings) {
    const mapping = byColumn.get(reading.source_column);
    const assetId = mapping?.assetNodeId ? scadaAssetByNode.get(mapping.assetNodeId) : undefined;
    if (!mapping || !assetId) {
      unmapped.add(reading.source_column);
      continue;
    }
    rows.push({
      company_id: companyId,
      project_id: args.project_id,
      scada_asset_id: assetId,
      ts: reading.ts,
      metric: mapping.metric,
      value: reading.value * mapping.factor + mapping.offset,
      quality: "good",
    });
  }

  let accepted = 0;
  let errorText: string | null = null;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await context.supabase.from("scada_telemetry").upsert(batch as never, {
      onConflict: "scada_asset_id,metric,ts",
      ignoreDuplicates: true,
    });
    if (error) {
      errorText = error.message;
      continue;
    }
    accepted += batch.length;
  }

  const rejected = parsed.readings.length - accepted;
  const status = errorText
    ? accepted > 0
      ? "partial"
      : "failed"
    : rejected > 0
      ? "partial"
      : "success";

  await context.supabase
    .from("ingestion_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      rows_accepted: accepted,
      rows_rejected: rejected,
      error_text: errorText,
      details: {
        unmapped_columns: Array.from(unmapped).slice(0, 50),
        parse_errors: parsed.errors.slice(0, 50),
      },
    } as never)
    .eq("id", runId);

  return {
    run_id: runId,
    rows_received: parsed.rowsReceived,
    rows_accepted: accepted,
    rows_rejected: rejected,
    unmapped_columns: Array.from(unmapped).slice(0, 50),
  };
}
