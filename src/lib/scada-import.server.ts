/**
 * P-172 — CSV / historian import server helpers.
 *
 * Import is an INTERNAL producer for the same telemetry pipeline the guarded
 * public hook feeds: resolve tag -> asset, chunk 500, insert with
 * `on conflict do nothing`. The P-121/P-122 guard chain is untouched.
 */
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  MAX_IMPORT_ERRORS,
  chunkRows,
  importStoragePath,
  parseCsvTable,
  validateCsvRows,
  type ImportError,
  type ImportMapping,
} from "@/lib/scada/csv-import";

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const UNDEFINED_TABLE = "42P01";

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

export interface ImportTagOption {
  id: string;
  tag: string;
  metric: string | null;
  unit: string | null;
  asset_node_id: string | null;
}

export async function listProjectTags(
  context: AuthContext,
  companyId: string,
  projectId: string,
): Promise<ImportTagOption[]> {
  const { data, error } = await context.supabase
    .from("tag_dictionary")
    .select("id, tag, metric, unit, asset_node_id")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("enabled", true)
    .order("tag", { ascending: true })
    .limit(1000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as ImportTagOption[];
}

export function buildUploadPath(companyId: string, projectId: string, filename: string): string {
  return importStoragePath(companyId, projectId, filename);
}

export interface CsvImportResult {
  accepted: number;
  rejected: number;
  errors: ImportError[];
  queued: boolean;
  storage_path: string | null;
}

/**
 * Enqueue failed batches for the P-177 retry queue. Until migration 0073
 * creates `ingestion_retry_queue` this catches 42P01 and reports queued:false.
 */
async function enqueueRetry(
  context: AuthContext,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await context.supabase
      .from("ingestion_retry_queue" as never)
      .insert(payload as never);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

export async function runCsvImport(
  context: AuthContext,
  companyId: string,
  args: {
    project_id: string;
    source_label: string;
    storage_path?: string | null;
    csv: string;
    mapping: ImportMapping;
  },
): Promise<CsvImportResult> {
  const table = parseCsvTable(args.csv);
  const tags = await listProjectTags(context, companyId, args.project_id);
  const knownTags = new Set(tags.map((t) => t.tag));
  const validated = validateCsvRows(table, args.mapping, knownTags);

  // tag -> metric + asset_node -> scada_asset
  const byTag = new Map(tags.map((t) => [t.tag, t]));
  const nodeIds = Array.from(
    new Set(tags.map((t) => t.asset_node_id).filter((v): v is string => Boolean(v))),
  );
  const assetByNode = new Map<string, string>();
  if (nodeIds.length > 0) {
    const { data: nodes, error } = await context.supabase
      .from("asset_nodes")
      .select("id, scada_asset_id")
      .in("id", nodeIds);
    if (error && !isMissingTable(error)) throw error;
    for (const n of (nodes ?? []) as { id: string; scada_asset_id: string | null }[]) {
      if (n.scada_asset_id) assetByNode.set(n.id, n.scada_asset_id);
    }
  }

  const errors: ImportError[] = [...validated.errors];
  const pushError = (e: ImportError) => {
    if (errors.length < MAX_IMPORT_ERRORS) errors.push(e);
  };

  let rejected = validated.rejected;
  const rows: Record<string, unknown>[] = [];
  const unresolved = new Set<string>();
  for (const reading of validated.readings) {
    const tag = byTag.get(reading.tag);
    const assetId = tag?.asset_node_id ? assetByNode.get(tag.asset_node_id) : undefined;
    if (!tag || !assetId) {
      rejected += 1;
      if (!unresolved.has(reading.tag)) {
        unresolved.add(reading.tag);
        pushError({ line: 0, column: reading.tag, reason: "tag_not_bound_to_asset" });
      }
      continue;
    }
    rows.push({
      company_id: companyId,
      project_id: args.project_id,
      scada_asset_id: assetId,
      ts: reading.ts,
      metric: tag.metric ?? reading.tag,
      value: reading.value,
      quality: "good",
    });
  }

  let accepted = 0;
  let queued = false;
  for (const batch of chunkRows(rows)) {
    const { error } = await context.supabase.from("scada_telemetry").upsert(batch as never, {
      onConflict: "scada_asset_id,metric,ts",
      ignoreDuplicates: true,
    });
    if (error) {
      rejected += batch.length;
      pushError({ line: 0, column: null, reason: `insert_failed:${error.code ?? "unknown"}` });
      const ok = await enqueueRetry(context, {
        company_id: companyId,
        project_id: args.project_id,
        source: "csv_import",
        payload: { rows: batch.length, storage_path: args.storage_path ?? null },
        error_text: error.message,
      });
      queued = queued || ok;
      continue;
    }
    accepted += batch.length;
  }

  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: "scada.csv_import",
      p_entity: "scada_telemetry",
      p_entity_id: args.project_id,
      p_metadata: {
        source_label: args.source_label,
        storage_path: args.storage_path ?? null,
        rows_received: validated.rowsReceived,
        accepted,
        rejected,
        errors: errors.length,
        queued,
      } as never,
    });
  } catch {
    /* audit is best-effort */
  }

  return { accepted, rejected, errors, queued, storage_path: args.storage_path ?? null };
}
