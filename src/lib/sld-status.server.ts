// P-146 — Server-only helpers for SLD governance (review rounds, approval
// engine wiring, IFC issuance). Kept out of the *.functions.ts module so
// server-fn splitting cannot drop them.
import { cadHttpError, isRemoved } from "./sld-cad.server";
import type { CadDrawing } from "./sld-cad.server";
import type { SldStatus, TransitionContext } from "./sld/status-machine";

export const SLD_APPROVAL_RULE_KEY = "sld_drawing_approval";
export const SLD_APPROVAL_ENTITY = "sld_drawing";

export type ApprovalStatus = TransitionContext["approvalStatus"];

export type GovernanceSnapshot = {
  drawing: CadDrawing & { drawing_register_id?: string | null };
  revisionId: string | null;
  revisionCode: string | null;
  objectCount: number;
  hasValidation: boolean;
  errorCount: number;
  warningCount: number;
  validationRanAt: string | null;
  openSignoffs: number;
  rounds: Array<{
    id: string;
    round_no: number;
    status: string;
    created_at: string;
    signoffs: Array<{
      id: string;
      reviewer_id: string;
      reviewer_org: string;
      decision: string | null;
      comment: string | null;
      signed_at: string | null;
    }>;
  }>;
  approval: {
    id: string;
    status: ApprovalStatus;
    current_step: number;
    sla_due_at: string | null;
    requested_at: string | null;
    steps: Array<{
      id: string;
      approver_id: string;
      step_order: number;
      status: string;
      due_at: string | null;
      decided_at: string | null;
      comment: string | null;
    }>;
  } | null;
};

export async function hasRole(context: any, companyId: string, role: string): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .eq("role", role)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function isEngineeringAdmin(context: any, companyId: string): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", ["engineering_admin", "company_admin", "super_admin"])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Loads everything the status machine needs to evaluate guards. */
export async function loadGovernance(
  context: any,
  drawing: CadDrawing,
): Promise<GovernanceSnapshot> {
  const revisionId = drawing.current_revision_id;

  let objectCount = 0;
  let validation: any = null;
  let revisionCode: string | null = null;

  if (revisionId) {
    const { data: revision, error: revErr } = await context.supabase
      .from("sld_revisions")
      .select("id, revision_code, canvas")
      .eq("id", revisionId)
      .maybeSingle();
    if (revErr) throw revErr;
    revisionCode = (revision as any)?.revision_code ?? null;
    validation = ((revision as any)?.canvas ?? {}).validation ?? null;

    const { data: objects, error: objErr } = await context.supabase
      .from("sld_objects")
      .select("id, properties")
      .eq("revision_id", revisionId);
    if (objErr) throw objErr;
    objectCount = ((objects ?? []) as any[]).filter((o) => !isRemoved(o.properties)).length;
  }

  const { data: roundRows, error: roundErr } = await context.supabase
    .from("drawing_review_rounds")
    .select("id, round_no, status, created_at, metadata")
    .eq("project_id", drawing.project_id)
    .order("round_no", { ascending: true });
  if (roundErr) throw roundErr;

  const sldRounds = ((roundRows ?? []) as any[]).filter(
    (r) => (r.metadata ?? {})?.sld_drawing_id === drawing.id,
  );

  let signoffRows: any[] = [];
  if (sldRounds.length > 0) {
    const { data, error } = await context.supabase
      .from("drawing_review_signoffs")
      .select("id, round_id, reviewer_id, reviewer_org, decision, comment, signed_at")
      .in(
        "round_id",
        sldRounds.map((r) => r.id),
      );
    if (error) throw error;
    signoffRows = (data ?? []) as any[];
  }

  const openSignoffs = signoffRows.filter(
    (s) => !s.decision && sldRounds.some((r) => r.id === s.round_id && r.status === "open"),
  ).length;

  const { data: instanceRows, error: instErr } = await context.supabase
    .from("approval_instances")
    .select("id, status, current_step, sla_due_at, requested_at, metadata")
    .eq("entity_type", SLD_APPROVAL_ENTITY)
    .eq("entity_id", drawing.id)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (instErr) throw instErr;

  const instance = ((instanceRows ?? []) as any[])[0] ?? null;
  let approval: GovernanceSnapshot["approval"] = null;
  if (instance) {
    const { data: steps, error: stepErr } = await context.supabase
      .from("approvals")
      .select("id, approver_id, step_order, status, due_at, decided_at, comment")
      .eq("instance_id", instance.id)
      .order("step_order", { ascending: true });
    if (stepErr) throw stepErr;
    approval = {
      id: instance.id,
      status: instance.status as ApprovalStatus,
      current_step: instance.current_step ?? 1,
      sla_due_at: instance.sla_due_at ?? null,
      requested_at: instance.requested_at ?? null,
      steps: (steps ?? []) as any[],
    };
  }

  return {
    drawing,
    revisionId,
    revisionCode,
    objectCount,
    hasValidation: Boolean(validation),
    errorCount: Number(validation?.error_count ?? 0),
    warningCount: Number(validation?.warning_count ?? 0),
    validationRanAt: validation?.ran_at ?? null,
    openSignoffs,
    rounds: sldRounds.map((r) => ({
      id: r.id,
      round_no: r.round_no,
      status: r.status,
      created_at: r.created_at,
      signoffs: signoffRows.filter((s) => s.round_id === r.id),
    })),
    approval,
  };
}

export function toTransitionContext(
  snap: GovernanceSnapshot,
  opts: { isEngineeringAdmin: boolean; hasReplacement: boolean },
): TransitionContext {
  return {
    current: snap.drawing.status as SldStatus,
    objectCount: snap.objectCount,
    hasValidation: snap.hasValidation,
    errorCount: snap.errorCount,
    openSignoffs: snap.openSignoffs,
    approvalStatus: (snap.approval?.status ?? "none") as ApprovalStatus,
    isEngineeringAdmin: opts.isEngineeringAdmin,
    hasReplacement: opts.hasReplacement,
  };
}

/** Opens a review round for the SLD revision and notifies eligible reviewers. */
export async function openReviewRound(context: any, snap: GovernanceSnapshot) {
  const drawing = snap.drawing;
  const nextNo = snap.rounds.reduce((m, r) => Math.max(m, r.round_no), 0) + 1;

  // Only a registered drawing has a drawing_revisions row to point at.
  let revisionFk: string | null = null;
  if (drawing.drawing_register_id) {
    const { data } = await context.supabase
      .from("drawing_revisions")
      .select("id")
      .eq("drawing_id", drawing.drawing_register_id)
      .order("created_at", { ascending: false })
      .limit(1);
    revisionFk = ((data ?? []) as any[])[0]?.id ?? null;
  }

  const { data: round, error } = await context.supabase
    .from("drawing_review_rounds")
    .insert({
      company_id: drawing.company_id,
      project_id: drawing.project_id,
      revision_id: revisionFk,
      round_no: nextNo,
      status: "open",
      metadata: {
        source: "sld_cad",
        sld_drawing_id: drawing.id,
        sld_revision_id: snap.revisionId,
        drawing_number: drawing.drawing_number,
      },
    } as any)
    .select("id, round_no")
    .single();
  if (error) throw error;

  const { data: reviewers } = await context.supabase
    .from("user_roles")
    .select("user_id, role")
    .eq("company_id", drawing.company_id)
    .in("role", ["engineering_admin", "engineer", "project_admin"]);

  const userIds = [...new Set(((reviewers ?? []) as any[]).map((r) => r.user_id))];
  if (userIds.length > 0) {
    await context.supabase.from("notifications").insert(
      userIds.map((uid) => ({
        company_id: drawing.company_id,
        user_id: uid,
        type: "sld_review_requested",
        title: `SLD ${drawing.drawing_number} is under review`,
        body: `${drawing.title} — review round ${(round as any).round_no}`,
        link: `/projects/${drawing.project_id}/engineering/sld-cad/${drawing.id}`,
      })) as any,
    );
  }

  return { roundId: (round as any).id as string, roundNo: (round as any).round_no as number };
}

const EQUIPMENT_TYPE_BY_SYMBOL: Record<string, string> = {
  inverter: "inverter",
  string_inverter: "inverter",
  central_inverter: "inverter",
  pv_string: "module_string",
  module_string: "module_string",
  tracker: "tracker",
  transformer: "transformer",
  mv_transformer: "transformer",
  meter: "meter",
  revenue_meter: "meter",
  weather_station: "weather_station",
  bess_container: "bess_container",
  battery_rack: "battery_rack",
  pcs: "pcs",
  switchgear: "switchgear",
  mv_switchgear: "switchgear",
  lv_switchgear: "switchgear",
};

export function mapEquipmentType(symbolType: string): string {
  return EQUIPMENT_TYPE_BY_SYMBOL[symbolType] ?? "other";
}

/**
 * Issues the drawing for construction: register entry, revision record, IFC
 * release snapshot and equipment traceability rows.
 */
export async function issueForConstruction(context: any, snap: GovernanceSnapshot) {
  const drawing = snap.drawing;
  if (!snap.revisionId) cadHttpError(409, "no_revision", "No revision to issue.");

  // 1. drawing_register entry (created once, then reused).
  let registerId = (drawing as any).drawing_register_id as string | null;
  if (!registerId) {
    const { data, error } = await context.supabase
      .from("drawing_register")
      .insert({
        company_id: drawing.company_id,
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        title: drawing.title,
        discipline: "electrical",
        tags: ["SLD"],
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    registerId = (data as any).id as string;
  }
  // P-249 — the register's status/lock derive from the mirrored revision below.

  // 2. drawing_revisions record mirroring the SLD revision.
  const revisionCode = snap.revisionCode ?? "A";
  const { data: revRow, error: revErr } = await context.supabase
    .from("drawing_revisions")
    .insert({
      company_id: drawing.company_id,
      drawing_id: registerId,
      revision_code: revisionCode,
      status: "IFC",
      storage_path: `sld/${drawing.id}/${snap.revisionId}.json`,
      file_name: `${drawing.drawing_number}-${revisionCode}.sld.json`,
      mime_type: "application/json",
      issue_reason: "Issued for construction from SLD CAD",
      issued_at: new Date().toISOString(),
    } as any)
    .select("id")
    .single();
  if (revErr) throw revErr;

  await context.supabase
    .from("drawing_register")
    .update({ current_revision_id: (revRow as any).id } as any)
    .eq("id", registerId);

  // 3. IFC release snapshot (append to the open prepared release, else create).
  const snapshotEntry = {
    drawing_id: drawing.id,
    revision_id: snap.revisionId,
    drawing_number: drawing.drawing_number,
    revision_code: revisionCode,
  };

  const { data: releases } = await context.supabase
    .from("ifc_releases")
    .select("id, revision_snapshot")
    .eq("project_id", drawing.project_id)
    .eq("status", "prepared")
    .order("created_at", { ascending: false })
    .limit(1);

  let releaseId: string;
  const openRelease = ((releases ?? []) as any[])[0];
  if (openRelease) {
    const existing = Array.isArray(openRelease.revision_snapshot)
      ? openRelease.revision_snapshot
      : [];
    const merged = [...existing.filter((e: any) => e?.drawing_id !== drawing.id), snapshotEntry];
    const { error } = await context.supabase
      .from("ifc_releases")
      .update({ revision_snapshot: merged } as any)
      .eq("id", openRelease.id);
    if (error) throw error;
    releaseId = openRelease.id;
  } else {
    const { data, error } = await context.supabase
      .from("ifc_releases")
      .insert({
        company_id: drawing.company_id,
        project_id: drawing.project_id,
        package_name: `SLD IFC — ${drawing.drawing_number}`,
        status: "prepared",
        revision_snapshot: [snapshotEntry],
        distribution_list: [],
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    releaseId = (data as any).id as string;
  }

  // 4. Equipment traceability (SLD tags → O&M asset registry).
  const { data: tagged } = await context.supabase
    .from("sld_objects")
    .select("tag, symbol_type, label, properties")
    .eq("revision_id", snap.revisionId)
    .not("tag", "is", null);

  const rows = ((tagged ?? []) as any[])
    .filter((o) => !isRemoved(o.properties) && String(o.tag ?? "").trim().length > 0)
    .map((o) => ({
      company_id: drawing.company_id,
      project_id: drawing.project_id,
      tag: String(o.tag).trim(),
      equipment_type: mapEquipmentType(String(o.symbol_type)),
      status: "inactive",
      location_text: o.label ?? null,
      specs: { source: "sld_cad", drawing_id: drawing.id, revision_id: snap.revisionId },
    }));

  let equipmentInserted = 0;
  if (rows.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("equipment_registry")
      .select("tag")
      .eq("project_id", drawing.project_id);
    const seen = new Set(((existing ?? []) as any[]).map((e) => e.tag));
    const fresh = rows.filter((r) => !seen.has(r.tag));
    if (fresh.length > 0) {
      const { error } = await supabaseAdmin.from("equipment_registry").insert(fresh as any);
      if (error) throw error;
      equipmentInserted = fresh.length;
    }
  }

  return {
    registerId,
    drawingRevisionId: (revRow as any).id as string,
    releaseId,
    equipmentInserted,
    equipmentCandidates: rows.length,
  };
}

/** Equipment status enum guard — the registry only accepts known values. */
export const EQUIPMENT_DEFAULT_STATUS = "inactive";
