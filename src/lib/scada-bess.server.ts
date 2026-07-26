// P-174 — BESS + curtailment strip for the live SCADA dashboard.
// Reads the P-173 daily views; null-safe when no such streams exist.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export interface BessCurtailmentStrip {
  bess: {
    available: boolean;
    fleetAvgSocPct: number | null;
    minSocPct: number | null;
    latestSohPct: number | null;
    assets: number;
  };
  curtailment: {
    available: boolean;
    avgKw: number | null;
    maxKw: number | null;
  };
  day: string;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
}

function isMissingRelation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "42P01";
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

export async function loadBessCurtailmentStrip(
  context: AuthContext,
  projectId?: string,
): Promise<BessCurtailmentStrip> {
  const cid = await companyId(context);
  const day = new Date().toISOString().slice(0, 10);

  let bessQ = context.supabase
    .from("v_bess_daily")
    .select("scada_asset_id, avg_soc_pct, min_soc_pct, latest_soh_pct, day")
    .eq("company_id", cid)
    .eq("day", day);
  if (projectId) bessQ = bessQ.eq("project_id", projectId);
  const bessRes = await bessQ;

  let curtQ = context.supabase
    .from("v_curtailment_daily")
    .select("avg_curtailment_kw, max_curtailment_kw, day")
    .eq("company_id", cid)
    .eq("day", day);
  if (projectId) curtQ = curtQ.eq("project_id", projectId);
  const curtRes = await curtQ;

  const bessRows =
    bessRes.error && !isMissingRelation(bessRes.error)
      ? []
      : ((bessRes.data ?? []) as {
          scada_asset_id: string;
          avg_soc_pct: number | string | null;
          min_soc_pct: number | string | null;
          latest_soh_pct: number | string | null;
        }[]);

  const curtRows =
    curtRes.error && !isMissingRelation(curtRes.error)
      ? []
      : ((curtRes.data ?? []) as {
          avg_curtailment_kw: number | string | null;
          max_curtailment_kw: number | string | null;
        }[]);

  const socs = bessRows.map((r) => Number(r.avg_soc_pct)).filter((n) => Number.isFinite(n));
  const mins = bessRows.map((r) => Number(r.min_soc_pct)).filter((n) => Number.isFinite(n));
  const sohs = bessRows.map((r) => Number(r.latest_soh_pct)).filter((n) => Number.isFinite(n));
  const cAvg = curtRows.map((r) => Number(r.avg_curtailment_kw)).filter((n) => Number.isFinite(n));
  const cMax = curtRows.map((r) => Number(r.max_curtailment_kw)).filter((n) => Number.isFinite(n));

  return {
    day,
    bess: {
      available: bessRows.length > 0,
      fleetAvgSocPct: avg(socs),
      minSocPct: mins.length ? Number(Math.min(...mins).toFixed(1)) : null,
      latestSohPct: sohs.length ? Number(Math.max(...sohs).toFixed(1)) : null,
      assets: bessRows.length,
    },
    curtailment: {
      available: curtRows.length > 0,
      avgKw: avg(cAvg),
      maxKw: cMax.length ? Number(Math.max(...cMax).toFixed(1)) : null,
    },
  };
}
