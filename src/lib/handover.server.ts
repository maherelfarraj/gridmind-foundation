// P-099 — Handover pure helpers (no createServerFn, per tanstack-serverfn-split).
import type { HandoverPrereqKey } from "@/lib/handover.rules";
import { HANDOVER_REASON_LABELS } from "@/lib/handover.rules";

type SB = any;

export interface HandoverPrereqResult {
  passes: Record<HandoverPrereqKey, boolean>;
  reasons: { key: HandoverPrereqKey; label: string }[];
  cccCertificateId: string | null;
}

/**
 * Runs the four handover prerequisites concurrently.
 *  - cod_signed: signed COD certificate exists
 *  - no_open_category_a_punch: zero open Category A punch items
 *  - turnover_delivered: turnover_packages.status in ('delivered','accepted')
 *  - ccc_signed: signed CCC certificate exists
 */
export async function checkHandoverPrereqs(
  supabase: SB,
  companyId: string,
  projectId: string,
): Promise<HandoverPrereqResult> {
  const [codRes, punchRes, turnoverRes, cccRes] = await Promise.all([
    supabase
      .from("commissioning_certificates")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("certificate_type", "cod")
      .eq("status", "signed"),
    supabase
      .from("qaqc_punch_items")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("category", "A")
      .neq("status", "closed")
      .neq("status", "void"),
    supabase
      .from("turnover_packages")
      .select("status")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .in("status", ["delivered", "accepted"])
      .limit(1),
    supabase
      .from("commissioning_certificates")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("certificate_type", "ccc_transfer")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const cod_signed = (codRes.count ?? 0) > 0;
  const no_open_category_a_punch = (punchRes.count ?? 0) === 0;
  const turnover_delivered = (turnoverRes.data ?? []).length > 0;
  const cccRow = ((cccRes.data ?? []) as { id: string; status: string }[])[0] ?? null;
  const ccc_signed = cccRow?.status === "signed";

  const passes = {
    cod_signed,
    no_open_category_a_punch,
    turnover_delivered,
    ccc_signed,
  } as Record<HandoverPrereqKey, boolean>;

  const reasons = (Object.keys(passes) as HandoverPrereqKey[])
    .filter((k) => !passes[k])
    .map((k) => ({ key: k, label: HANDOVER_REASON_LABELS[k] }));

  return { passes, reasons, cccCertificateId: cccRow?.id ?? null };
}

/**
 * Assembles the immutable handover timeline from audit_logs. Newest-first.
 * Never mutates — audit_logs is append-only.
 */
export async function assembleHandoverHistory(
  supabase: SB,
  companyId: string,
  projectId: string,
): Promise<
  Array<{
    id: string;
    action: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    entity: string;
    entity_id: string | null;
    metadata: Record<string, any>;
    created_at: string;
  }>
> {
  // Certificate ids for this project (so we can pull their audit rows).
  const { data: certs } = await supabase
    .from("commissioning_certificates")
    .select("id")
    .eq("company_id", companyId)
    .eq("project_id", projectId);
  const certIds = ((certs ?? []) as { id: string }[]).map((c) => c.id);

  // Gate rows for this project.
  const { data: gates } = await supabase
    .from("project_phase_gates")
    .select("id")
    .eq("company_id", companyId)
    .eq("project_id", projectId);
  const gateIds = ((gates ?? []) as { id: string }[]).map((g) => g.id);

  const filters: string[] = [
    `and(entity.eq.projects,entity_id.eq.${projectId})`,
  ];
  if (gateIds.length > 0) {
    filters.push(
      `and(entity.eq.project_phase_gates,entity_id.in.(${gateIds.join(",")}))`,
    );
  }
  if (certIds.length > 0) {
    filters.push(
      `and(entity.eq.commissioning_certificates,entity_id.in.(${certIds.join(",")}))`,
    );
  }

  const { data: rows } = await supabase
    .from("audit_logs")
    .select("id, action, actor_id, entity, entity_id, metadata, created_at")
    .eq("company_id", companyId)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (rows ?? []) as any[];
  const actorIds = Array.from(
    new Set(list.map((r) => r.actor_id).filter((v: unknown): v is string => !!v)),
  );
  let actorMap: Record<
    string,
    { full_name: string | null; email: string | null }
  > = {};
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const p of (profs ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      actorMap[p.id] = { full_name: p.full_name, email: p.email };
    }
  }

  return list.map((r) => ({
    id: r.id,
    action: r.action,
    actor_id: r.actor_id ?? null,
    actor_name: r.actor_id ? actorMap[r.actor_id]?.full_name ?? null : null,
    actor_email: r.actor_id ? actorMap[r.actor_id]?.email ?? null : null,
    entity: r.entity,
    entity_id: r.entity_id ?? null,
    metadata: r.metadata ?? {},
    created_at: r.created_at,
  }));
}

/**
 * Auto-complete the CCC/turnover/punch checklist items on a handover gate.
 * Preserves any items with unknown keys. Injects missing items with done=true.
 */
export function autoCompleteHandoverChecklist(
  current: unknown,
  userId: string,
  nowIso: string,
): any[] {
  const items: any[] = Array.isArray(current) ? [...current] : [];
  const wantKeys = ["ccc_signed", "turnover_delivered", "punch_list_closed"];
  const labels: Record<string, string> = {
    ccc_signed: "Care, Custody & Control certificate signed",
    turnover_delivered: "Turnover pack delivered",
    punch_list_closed: "Category A punch list closed",
  };
  const next = items.map((it: any) => {
    if (wantKeys.includes(String(it?.key))) {
      return {
        key: it.key,
        label: it.label ?? labels[it.key],
        required: it.required !== false,
        done: true,
        done_by: userId,
        done_at: nowIso,
      };
    }
    return it;
  });
  for (const key of wantKeys) {
    if (!next.some((it: any) => it?.key === key)) {
      next.push({
        key,
        label: labels[key],
        required: true,
        done: true,
        done_by: userId,
        done_at: nowIso,
      });
    }
  }
  return next;
}
