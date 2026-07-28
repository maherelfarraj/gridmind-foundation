// P-261 — Certified subcontractor claims flow into project actual cost.
// Server-only helper (mirrors the labor-rollup pattern): missing objects
// (42P01) degrade silently so EVM keeps working on older tenants.
import { certifiedSubActuals } from "@/lib/subcontract-finance.rules";

type AnySupabase = {
  from: (t: string) => any;
};

export async function loadCertifiedSubcontractActuals(
  supabase: AnySupabase,
  projectId: string,
  asOfDate: string,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("subcontract_claims")
      .select("status, certified_at, this_period_amount, subcontracts!inner(project_id)")
      .eq("subcontracts.project_id", projectId)
      .eq("status", "certified");
    if (error) {
      if (String((error as { code?: string }).code) === "42P01") return 0;
      throw error;
    }
    return certifiedSubActuals(
      ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        status: String(r.status),
        certified_at: (r.certified_at as string) ?? null,
        this_period_amount: Number(r.this_period_amount ?? 0),
      })),
      asOfDate,
    );
  } catch {
    return 0;
  }
}
