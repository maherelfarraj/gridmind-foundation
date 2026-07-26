// P-174 — Multi-tag time-series explorer server helpers.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  assignAxes,
  bucketizeTag,
  buildTrendCsv,
  pickBucketWidth,
  type BucketWidth,
  type RawSample,
  type TrendSeries,
} from "@/lib/scada/trends";

export interface TrendTagOption {
  id: string;
  tag: string;
  metric: string;
  unit: string | null;
  description: string | null;
  node_id: string | null;
  node_name: string | null;
  project_id: string | null;
}

async function companyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 400 });
  return cid;
}

export async function listTrendTags(
  context: AuthContext,
  search?: string,
): Promise<TrendTagOption[]> {
  const cid = await companyId(context);
  let q = context.supabase
    .from("tag_dictionary")
    .select(
      "id, tag, metric, unit, description, asset_node_id, project_id, node:asset_nodes(name)",
    )
    .eq("company_id", cid)
    .eq("enabled", true)
    .order("tag", { ascending: true })
    .limit(500);
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    q = q.or(`tag.ilike.${term},metric.ilike.${term},description.ilike.${term}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown> & { node?: { name: string } | null };
    return {
      id: r.id as string,
      tag: r.tag as string,
      metric: r.metric as string,
      unit: (r.unit as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      node_id: (r.asset_node_id as string | null) ?? null,
      node_name: r.node?.name ?? null,
      project_id: (r.project_id as string | null) ?? null,
    };
  });
}

export interface TrendPayload {
  bucket: BucketWidth;
  from: string;
  to: string;
  series: TrendSeries[];
  totalBadSamples: number;
}

interface TagMeta {
  id: string;
  tag: string;
  metric: string;
  unit: string | null;
  scaling_factor: number | null;
  scaling_offset: number | null;
  asset_node_id: string | null;
  node_name: string | null;
  scada_asset_id: string | null;
}

async function loadTagMeta(context: AuthContext, tagIds: string[]): Promise<TagMeta[]> {
  const cid = await companyId(context);
  const { data, error } = await context.supabase
    .from("tag_dictionary")
    .select(
      "id, tag, metric, unit, scaling_factor, scaling_offset, asset_node_id, node:asset_nodes(name, scada_asset_id)",
    )
    .eq("company_id", cid)
    .in("id", tagIds);
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown> & {
      node?: { name: string; scada_asset_id: string | null } | null;
    };
    return {
      id: r.id as string,
      tag: r.tag as string,
      metric: r.metric as string,
      unit: (r.unit as string | null) ?? null,
      scaling_factor: r.scaling_factor == null ? null : Number(r.scaling_factor),
      scaling_offset: r.scaling_offset == null ? null : Number(r.scaling_offset),
      asset_node_id: (r.asset_node_id as string | null) ?? null,
      node_name: r.node?.name ?? null,
      scada_asset_id: r.node?.scada_asset_id ?? null,
    };
  });
}

/**
 * Fetch + bucketize + scale. Raw values never leave the server unscaled:
 * scaling_factor/offset are applied here before the DTO is returned.
 */
export async function loadTrendSeries(
  context: AuthContext,
  input: { tagIds: string[]; from: string; to: string },
): Promise<TrendPayload> {
  const bucket = pickBucketWidth(input.from, input.to);
  const metas = await loadTagMeta(context, input.tagIds);
  const axes = assignAxes(metas.map((m) => m.unit));

  const series: TrendSeries[] = [];
  let totalBad = 0;

  for (let i = 0; i < metas.length; i += 1) {
    const meta = metas[i];
    let samples: RawSample[] = [];
    if (meta.scada_asset_id) {
      const { data, error } = await context.supabase
        .from("scada_telemetry")
        .select("ts, value, quality")
        .eq("scada_asset_id", meta.scada_asset_id)
        .eq("metric", meta.metric)
        .gte("ts", input.from)
        .lte("ts", input.to)
        .order("ts", { ascending: true })
        .limit(50_000);
      if (error) throw error;
      samples = ((data ?? []) as unknown[]).map((raw) => {
        const r = raw as { ts: string; value: number | string; quality: string | null };
        return { ts: r.ts, value: Number(r.value), quality: r.quality };
      });
    }
    const { points, badCount } = bucketizeTag(samples, meta, bucket);
    totalBad += badCount;
    series.push({
      tagId: meta.id,
      tag: meta.tag,
      metric: meta.metric,
      unit: meta.unit,
      nodeName: meta.node_name,
      axis: axes[i] ?? "left",
      points,
      badCount,
    });
  }

  return { bucket, from: input.from, to: input.to, series, totalBadSamples: totalBad };
}

export async function buildTrendCsvExport(
  context: AuthContext,
  input: { tagIds: string[]; from: string; to: string; projectId?: string | null },
): Promise<{ filename: string; csv: string }> {
  const { assertExportAllowed } = await import("@/lib/export-guard");
  await assertExportAllowed(context.supabase, input.projectId ?? null, "csv");
  const payload = await loadTrendSeries(context, input);
  return {
    filename: `scada-trends-${input.from.slice(0, 10)}_${input.to.slice(0, 10)}.csv`,
    csv: buildTrendCsv(payload.series),
  };
}
