// P-112 — Approval inbox server functions.
// listMyApprovals / getApprovalInstance / getMyPendingCount + decideApproval re-export.
import { createServerFn } from "@tanstack/react-start";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

// Re-export the RPC wrapper so components only import from one module.
export { decideApproval } from "@/lib/approvals.functions";

const TAB = z.enum(["pending", "decided", "all"]);

async function assertCompanyAdmin(context: AuthContext): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_company_role", {
    p_role: "company_admin",
  });
  if (error) throw error;
  return data === true;
}

export interface InboxRow {
  approval_id: string;
  instance_id: string;
  approver_id: string;
  approver_name: string | null;
  approval_status: "pending" | "approved" | "rejected" | "skipped";
  approval_comment: string | null;
  approval_decided_at: string | null;
  step_order: number;
  total_steps: number;
  step_role: string | null;
  step_due_at: string | null;
  entity_type: string;
  entity_id: string;
  rule_key: string | null;
  amount: number | null;
  currency: string | null;
  metadata: Json;
  requester_id: string | null;
  requester_name: string | null;
  instance_status: string;
  sla_due_at: string | null;
  requested_at: string;
  escalated_at: string | null;
  title: string;
}

function asObject(json: Json | null | undefined): { [k: string]: Json | undefined } {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as { [k: string]: Json | undefined })
    : {};
}
function pickString(json: Json | null | undefined, key: string): string | null {
  const v = asObject(json)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function deriveTitle(
  metadata: Json | null | undefined,
  entityType: string,
  entityId: string,
): string {
  for (const k of ["title", "name", "reference", "po_number", "contract_number"]) {
    const v = pickString(metadata, k);
    if (v && v.trim().length > 0) return v;
  }
  return `${entityType} ${entityId.slice(0, 8)}`;
}

async function nameMap(
  context: AuthContext,
  ids: string[],
): Promise<Map<string, string | null>> {
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (clean.length === 0) return new Map();
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", clean as string[]);
  if (error) throw error;
  const map = new Map<string, string | null>();
  for (const p of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    map.set(p.id, p.full_name ?? p.email ?? null);
  }
  return map;
}

async function stepCountMap(
  context: AuthContext,
  instanceIds: string[],
): Promise<Map<string, number>> {
  const clean = Array.from(new Set(instanceIds));
  if (clean.length === 0) return new Map();
  const { data, error } = await context.supabase
    .from("approvals")
    .select("instance_id, step_order")
    .in("instance_id", clean as string[]);
  if (error) throw error;
  const totals = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    instance_id: string;
    step_order: number;
  }>) {
    const prev = totals.get(r.instance_id) ?? 0;
    if (r.step_order > prev) totals.set(r.instance_id, r.step_order);
  }
  return totals;
}

export const listMyApprovals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ tab: TAB.default("pending") }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const uid = context.user!.id;
    const isAdmin = data.tab === "all" ? await assertCompanyAdmin(context) : false;
    if (data.tab === "all" && !isAdmin) return [] as InboxRow[];

    let q = context.supabase
      .from("approvals")
      .select(
        "id, instance_id, approver_id, status, comment, decided_at, step_order, due_at",
      );

    if (data.tab === "pending") {
      q = q.eq("approver_id", uid).eq("status", "pending");
    } else if (data.tab === "decided") {
      q = q.eq("approver_id", uid).in("status", ["approved", "rejected", "skipped"]);
    }

    const { data: appr, error: apprErr } = await q.order("due_at", {
      ascending: true,
      nullsFirst: false,
    });
    if (apprErr) throw apprErr;
    const approvals =
      (appr as Array<{
        id: string;
        instance_id: string;
        approver_id: string;
        status: "pending" | "approved" | "rejected" | "skipped";
        comment: string | null;
        decided_at: string | null;
        step_order: number;
        due_at: string | null;
      }>) ?? [];

    if (approvals.length === 0) return [] as InboxRow[];

    const instanceIds = approvals.map((a) => a.instance_id);
    const { data: insts, error: instErr } = await context.supabase
      .from("approval_instances")
      .select(
        "id, entity_type, entity_id, rule_key, amount, metadata, requested_by, status, sla_due_at, requested_at",
      )
      .in("id", instanceIds as string[]);
    if (instErr) throw instErr;

    const instancesById = new Map(
      ((insts ?? []) as Array<{
        id: string;
        entity_type: string;
        entity_id: string;
        rule_key: string | null;
        amount: number | null;
        metadata: Json;
        requested_by: string | null;
        status: string;
        sla_due_at: string | null;
        requested_at: string;
      }>).map((i) => [i.id, i]),
    );

    // Fetch chain step role labels (best-effort via approval_chain_steps by rule_key not
    // available directly on approvals row; use approval_chain_steps via instance rule_id
    // is heavier — instead show step_order only, role optional from metadata.step_role).
    const totals = await stepCountMap(context, instanceIds);

    const namesNeeded = new Set<string>();
    for (const a of approvals) namesNeeded.add(a.approver_id);
    for (const i of instancesById.values())
      if (i.requested_by) namesNeeded.add(i.requested_by);
    const names = await nameMap(context, Array.from(namesNeeded));

    const rows: InboxRow[] = approvals.map((a) => {
      const inst = instancesById.get(a.instance_id);
      const metadata = (inst?.metadata ?? {}) as Json;
      const escalated = pickString(metadata, "escalated_at");
      const stepRole = pickString(metadata, "step_role");
      const currency = pickString(metadata, "currency");
      const title = deriveTitle(
        metadata,
        inst?.entity_type ?? "unknown",
        inst?.entity_id ?? a.instance_id,
      );
      return {
        approval_id: a.id,
        instance_id: a.instance_id,
        approver_id: a.approver_id,
        approver_name: names.get(a.approver_id) ?? null,
        approval_status: a.status,
        approval_comment: a.comment,
        approval_decided_at: a.decided_at,
        step_order: a.step_order,
        total_steps: totals.get(a.instance_id) ?? a.step_order,
        step_role: stepRole,
        step_due_at: a.due_at,
        entity_type: inst?.entity_type ?? "unknown",
        entity_id: inst?.entity_id ?? a.instance_id,
        rule_key: inst?.rule_key ?? null,
        amount: inst?.amount ?? null,
        currency,
        metadata,
        requester_id: inst?.requested_by ?? null,
        requester_name: inst?.requested_by
          ? names.get(inst.requested_by) ?? null
          : null,
        instance_status: inst?.status ?? "unknown",
        sla_due_at: inst?.sla_due_at ?? null,
        requested_at: inst?.requested_at ?? a.decided_at ?? new Date().toISOString(),
        escalated_at: escalated,
        title,
      };
    });

    // For "all" tab, pin escalated to the top; otherwise keep due-date sort.
    if (data.tab === "all") {
      rows.sort((a, b) => {
        const aEsc = a.escalated_at ? 1 : 0;
        const bEsc = b.escalated_at ? 1 : 0;
        if (aEsc !== bEsc) return bEsc - aEsc;
        const ad = a.sla_due_at ?? "9999";
        const bd = b.sla_due_at ?? "9999";
        return ad.localeCompare(bd);
      });
    }
    return rows;
  });

export const getMyPendingCount = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const uid = context.user!.id;
    const { count, error } = await context.supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("approver_id", uid)
      .eq("status", "pending");
    if (error) throw error;
    return { count: count ?? 0 };
  });

export interface ApprovalStepGroup {
  step_order: number;
  approvals: Array<{
    id: string;
    approver_id: string;
    approver_name: string | null;
    status: "pending" | "approved" | "rejected" | "skipped";
    comment: string | null;
    decided_at: string | null;
    due_at: string | null;
  }>;
}

export interface InstanceDetail {
  id: string;
  entity_type: string;
  entity_id: string;
  rule_key: string | null;
  amount: number | null;
  currency: string | null;
  metadata: Json;
  status: string;
  requested_at: string;
  requester_id: string | null;
  requester_name: string | null;
  sla_due_at: string | null;
  completed_at: string | null;
  current_step: number;
  escalated_at: string | null;
  title: string;
  steps: ApprovalStepGroup[];
  audit: Array<{
    id: string;
    action: string;
    created_at: string;
    actor_id: string | null;
    actor_name: string | null;
    metadata: Json;
  }>;
}

export const getApprovalInstance = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ instance_id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<InstanceDetail> => {
    requireSupabaseAuth(context);
    const { data: inst, error } = await context.supabase
      .from("approval_instances")
      .select(
        "id, entity_type, entity_id, rule_key, amount, metadata, requested_by, status, sla_due_at, requested_at, completed_at, current_step",
      )
      .eq("id", data.instance_id)
      .maybeSingle();
    if (error) throw error;
    if (!inst) throw new Error("approval_instance_not_found");
    const i = inst as {
      id: string;
      entity_type: string;
      entity_id: string;
      rule_key: string | null;
      amount: number | null;
      metadata: Json;
      requested_by: string | null;
      status: string;
      sla_due_at: string | null;
      requested_at: string;
      completed_at: string | null;
      current_step: number;
    };

    const { data: appr, error: apprErr } = await context.supabase
      .from("approvals")
      .select(
        "id, approver_id, status, comment, decided_at, due_at, step_order",
      )
      .eq("instance_id", data.instance_id)
      .order("step_order", { ascending: true })
      .order("decided_at", { ascending: true, nullsFirst: false });
    if (apprErr) throw apprErr;

    const approvals =
      (appr as Array<{
        id: string;
        approver_id: string;
        status: "pending" | "approved" | "rejected" | "skipped";
        comment: string | null;
        decided_at: string | null;
        due_at: string | null;
        step_order: number;
      }>) ?? [];

    const { data: audit, error: audErr } = await context.supabase
      .from("audit_logs")
      .select("id, action, created_at, actor_id, metadata")
      .eq("entity", "approval_instances")
      .eq("entity_id", data.instance_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (audErr) throw audErr;
    const auditRows =
      (audit as Array<{
        id: string;
        action: string;
        created_at: string;
        actor_id: string | null;
        metadata: Json;
      }>) ?? [];

    const namesNeeded = new Set<string>();
    if (i.requested_by) namesNeeded.add(i.requested_by);
    for (const a of approvals) namesNeeded.add(a.approver_id);
    for (const a of auditRows) if (a.actor_id) namesNeeded.add(a.actor_id);
    const names = await nameMap(context, Array.from(namesNeeded));

    const stepMap = new Map<number, ApprovalStepGroup>();
    for (const a of approvals) {
      const grp = stepMap.get(a.step_order) ?? {
        step_order: a.step_order,
        approvals: [],
      };
      grp.approvals.push({
        id: a.id,
        approver_id: a.approver_id,
        approver_name: names.get(a.approver_id) ?? null,
        status: a.status,
        comment: a.comment,
        decided_at: a.decided_at,
        due_at: a.due_at,
      });
      stepMap.set(a.step_order, grp);
    }
    const steps = Array.from(stepMap.values()).sort(
      (a, b) => a.step_order - b.step_order,
    );

    const metadata = i.metadata ?? {};
    const escalated =
      typeof (metadata as Json).escalated_at === "string"
        ? ((metadata as Json).escalated_at as string)
        : null;
    const currency =
      typeof (metadata as Json).currency === "string"
        ? ((metadata as Json).currency as string)
        : null;

    return {
      id: i.id,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      rule_key: i.rule_key,
      amount: i.amount,
      currency,
      metadata: metadata as Json,
      status: i.status,
      requested_at: i.requested_at,
      requester_id: i.requested_by,
      requester_name: i.requested_by ? names.get(i.requested_by) ?? null : null,
      sla_due_at: i.sla_due_at,
      completed_at: i.completed_at,
      current_step: i.current_step,
      escalated_at: escalated,
      title: deriveTitle(
        metadata as Json,
        i.entity_type,
        i.entity_id,
      ),
      steps,
      audit: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        created_at: a.created_at,
        actor_id: a.actor_id,
        actor_name: a.actor_id ? names.get(a.actor_id) ?? null : null,
        metadata: a.metadata ?? {},
      })),
    };
  });

export const canSeeAllApprovals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("has_company_role", {
      p_role: "company_admin",
    });
    if (error) throw error;
    return { allowed: data === true };
  });
