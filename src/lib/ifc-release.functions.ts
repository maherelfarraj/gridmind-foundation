// P-060 — IFC release ceremony server functions (RLS-scoped).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// constants + helpers
// ---------------------------------------------------------------------------
const IFC_ADMIN_ROLES = [
  "engineering_admin",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;

export const IFC_SIGNOFF_ROLES = [
  "Lead Engineer",
  "Engineering Manager",
  "Project Director",
] as const;
export type IfcSignoffRoleLabel = (typeof IFC_SIGNOFF_ROLES)[number];

const REQUIRED_SIGNOFF_ROLES: IfcSignoffRoleLabel[] = ["Lead Engineer", "Engineering Manager"];

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProjectCompany(context: any, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string };
}

async function loadRelease(context: any, releaseId: string) {
  const { data, error } = await context.supabase
    .from("ifc_releases")
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "release_not_found");
  return data as any;
}

async function isAdminOfCompany(context: any, companyId: string) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", IFC_ADMIN_ROLES as unknown as string[])
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

async function assertIfcAdmin(context: any, companyId: string) {
  const ok = await isAdminOfCompany(context, companyId);
  if (!ok) httpError(403, "forbidden");
}

async function audit(
  context: any,
  action: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "ifc_releases",
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    // never fail the write on audit
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RevisionSnapshotEntry {
  drawing_id: string;
  revision_id: string;
  drawing_number: string;
  revision_code: string;
  discipline: string;
  title: string;
}

export interface DistributionEntry {
  profile_id: string;
  name: string;
  email: string | null;
  org?: string | null;
}

export interface IfcReleaseRow {
  id: string;
  project_id: string;
  company_id: string;
  package_name: string;
  notes: string | null;
  status: "prepared" | "released" | "void";
  revision_snapshot: RevisionSnapshotEntry[];
  distribution_list: DistributionEntry[];
  prepared_by: string | null;
  prepared_by_name: string | null;
  released_by: string | null;
  released_by_name: string | null;
  released_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  signoff_count: number;
}

export interface IfcSignoffRow {
  id: string;
  release_id: string;
  signer_id: string;
  signer_name: string;
  signer_email: string | null;
  role_label: IfcSignoffRoleLabel;
  signature_text: string;
  signed_at: string;
}

export interface ReleasableDrawing {
  drawing_id: string;
  drawing_number: string;
  title: string;
  discipline: string;
  current_status: string;
  latest_ifd_revision_id: string | null;
  latest_ifd_revision_code: string | null;
  eligible: boolean;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// listIfcReleases
// ---------------------------------------------------------------------------
export const listIfcReleases = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<IfcReleaseRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("ifc_releases")
      .select(
        "*, prepared_profile:profiles!ifc_releases_prepared_by_fkey(id, full_name, email), released_profile:profiles!ifc_releases_released_by_fkey(id, full_name, email)",
      )
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const list = (rows ?? []) as any[];
    if (list.length === 0) return [];

    const ids = list.map((r) => r.id);
    const { data: signoffCounts, error: sErr } = await context.supabase
      .from("ifc_release_signoffs")
      .select("release_id")
      .in("release_id", ids);
    if (sErr) throw sErr;
    const counts = new Map<string, number>();
    for (const s of (signoffCounts ?? []) as any[]) {
      counts.set(s.release_id, (counts.get(s.release_id) ?? 0) + 1);
    }

    return list.map((r) => toReleaseRow(r, counts.get(r.id) ?? 0));
  });

function toReleaseRow(r: any, signoffCount: number): IfcReleaseRow {
  return {
    id: r.id,
    project_id: r.project_id,
    company_id: r.company_id,
    package_name: r.package_name,
    notes: r.notes ?? null,
    status: r.status,
    revision_snapshot: Array.isArray(r.revision_snapshot)
      ? (r.revision_snapshot as RevisionSnapshotEntry[])
      : [],
    distribution_list: Array.isArray(r.distribution_list)
      ? (r.distribution_list as DistributionEntry[])
      : [],
    prepared_by: r.prepared_by ?? null,
    prepared_by_name: r.prepared_profile?.full_name ?? r.prepared_profile?.email ?? null,
    released_by: r.released_by ?? null,
    released_by_name: r.released_profile?.full_name ?? r.released_profile?.email ?? null,
    released_at: r.released_at ?? null,
    voided_by: r.voided_by ?? null,
    voided_at: r.voided_at ?? null,
    void_reason: r.void_reason ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    signoff_count: signoffCount,
  };
}

// ---------------------------------------------------------------------------
// getIfcRelease (detail + signoffs)
// ---------------------------------------------------------------------------
export const getIfcRelease = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ releaseId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ release: IfcReleaseRow; signoffs: IfcSignoffRow[] }> => {
      requireSupabaseAuth(context);
      const { data: r, error } = await context.supabase
        .from("ifc_releases")
        .select(
          "*, prepared_profile:profiles!ifc_releases_prepared_by_fkey(id, full_name, email), released_profile:profiles!ifc_releases_released_by_fkey(id, full_name, email)",
        )
        .eq("id", data.releaseId)
        .maybeSingle();
      if (error) throw error;
      if (!r) httpError(404, "release_not_found");

      const { data: signoffs, error: sErr } = await context.supabase
        .from("ifc_release_signoffs")
        .select(
          "id, release_id, signer_id, role_label, signature_text, signed_at, signer:profiles!ifc_release_signoffs_signer_id_fkey(id, full_name, email)",
        )
        .eq("release_id", data.releaseId)
        .order("signed_at", { ascending: true });
      if (sErr) throw sErr;

      const so = ((signoffs ?? []) as any[]).map((s) => ({
        id: s.id,
        release_id: s.release_id,
        signer_id: s.signer_id,
        signer_name: s.signer?.full_name ?? s.signer?.email ?? "—",
        signer_email: s.signer?.email ?? null,
        role_label: s.role_label as IfcSignoffRoleLabel,
        signature_text: s.signature_text,
        signed_at: s.signed_at,
      }));

      return { release: toReleaseRow(r, so.length), signoffs: so };
    },
  );

// ---------------------------------------------------------------------------
// listReleasableDrawings — evaluates every drawing against the same governance
// rules the drawings transition uses for IFC, returning per-drawing reasons.
// ---------------------------------------------------------------------------
async function computeReleasable(context: any, projectId: string): Promise<ReleasableDrawing[]> {
  {
    const { data: drawings, error } = await context.supabase
      .from("drawing_register")
      .select("id, drawing_number, title, discipline, current_status, locked")
      .eq("project_id", projectId)
      .order("drawing_number", { ascending: true });
    if (error) throw error;
    const list = (drawings ?? []) as any[];
    if (list.length === 0) return [];

    const drawingIds = list.map((d) => d.id);
    const { data: revs, error: rErr } = await context.supabase
      .from("drawing_revisions")
      .select("id, drawing_id, revision_code, status, created_at")
      .in("drawing_id", drawingIds)
      .order("created_at", { ascending: false });
    if (rErr) throw rErr;
    const revList = (revs ?? []) as any[];

    // Group latest IFD revision per drawing.
    const latestIfdByDrawing = new Map<string, any>();
    const allIfdByDrawing = new Map<string, any[]>();
    for (const r of revList) {
      if (r.status === "IFD") {
        if (!latestIfdByDrawing.has(r.drawing_id)) {
          latestIfdByDrawing.set(r.drawing_id, r);
        }
        const arr = allIfdByDrawing.get(r.drawing_id) ?? [];
        arr.push(r);
        allIfdByDrawing.set(r.drawing_id, arr);
      }
    }

    // Open/rejected markups per drawing (across all its revisions).
    const revisionIds = revList.map((r) => r.id);
    const openMarkupsByDrawing = new Map<string, number>();
    if (revisionIds.length > 0) {
      const { data: markups, error: mErr } = await context.supabase
        .from("document_markups")
        .select("id, revision_id, status")
        .in("revision_id", revisionIds)
        .in("status", ["open", "rejected"]);
      if (mErr) throw mErr;
      const revToDrawing = new Map<string, string>();
      for (const r of revList) revToDrawing.set(r.id, r.drawing_id);
      for (const m of (markups ?? []) as any[]) {
        const did = revToDrawing.get(m.revision_id);
        if (!did) continue;
        openMarkupsByDrawing.set(did, (openMarkupsByDrawing.get(did) ?? 0) + 1);
      }
    }

    // Review rounds for the latest IFD revisions.
    const latestIfdIds = Array.from(latestIfdByDrawing.values()).map((r) => r.id);
    const roundsByRevision = new Map<string, any>();
    if (latestIfdIds.length > 0) {
      const { data: rounds, error: rrErr } = await context.supabase
        .from("drawing_review_rounds")
        .select("id, revision_id, status, round_no")
        .in("revision_id", latestIfdIds)
        .order("round_no", { ascending: false });
      if (rrErr) throw rrErr;
      for (const rd of (rounds ?? []) as any[]) {
        if (!roundsByRevision.has(rd.revision_id)) {
          roundsByRevision.set(rd.revision_id, rd);
        }
      }
    }

    const roundIds = Array.from(roundsByRevision.values()).map((r) => r.id);
    const signoffsByRound = new Map<string, any[]>();
    if (roundIds.length > 0) {
      const { data: so, error: soErr } = await context.supabase
        .from("drawing_review_signoffs")
        .select("id, round_id, decision")
        .in("round_id", roundIds);
      if (soErr) throw soErr;
      for (const s of (so ?? []) as any[]) {
        const arr = signoffsByRound.get(s.round_id) ?? [];
        arr.push(s);
        signoffsByRound.set(s.round_id, arr);
      }
    }

    return list.map((d) => {
      const reasons: string[] = [];
      const latestIfd = latestIfdByDrawing.get(d.id);
      if (d.locked && d.current_status === "IFC") {
        reasons.push("Already released as IFC — supersede first.");
      }
      if (!latestIfd) {
        reasons.push("No IFD revision on record.");
      }
      const openMarkups = openMarkupsByDrawing.get(d.id) ?? 0;
      if (openMarkups > 0) {
        reasons.push(`${openMarkups} open/rejected markup(s).`);
      }
      if (latestIfd) {
        const round = roundsByRevision.get(latestIfd.id);
        if (!round) {
          reasons.push("No review round on latest IFD revision.");
        } else {
          const so = signoffsByRound.get(round.id) ?? [];
          if (so.length === 0) {
            reasons.push("Review round has no reviewers.");
          } else {
            const pending = so.filter((s) => s.decision == null).length;
            if (pending > 0) {
              reasons.push(`${pending} reviewer(s) still pending.`);
            }
          }
        }
      }
      return {
        drawing_id: d.id,
        drawing_number: d.drawing_number,
        title: d.title,
        discipline: d.discipline,
        current_status: d.current_status,
        latest_ifd_revision_id: latestIfd?.id ?? null,
        latest_ifd_revision_code: latestIfd?.revision_code ?? null,
        eligible: reasons.length === 0,
        reasons,
      };
    });
  }
}

export const listReleasableDrawings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ReleasableDrawing[]> => {
    requireSupabaseAuth(context);
    return computeReleasable(context, data.projectId);
  });

// ---------------------------------------------------------------------------
// prepareIfcRelease
// ---------------------------------------------------------------------------
const prepareInput = z.object({
  projectId: z.string().uuid(),
  packageName: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(2000).optional(),
  drawingIds: z.array(z.string().uuid()).min(1),
  distribution: z
    .array(
      z.object({
        profile_id: z.string().uuid(),
        name: z.string(),
        email: z.string().nullable(),
        org: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export const prepareIfcRelease = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => prepareInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertIfcAdmin(context, project.company_id);

    const releasable = await computeReleasable(context, data.projectId);

    const byId = new Map<string, ReleasableDrawing>();
    for (const d of releasable) byId.set(d.drawing_id, d);

    const missing: string[] = [];
    const blocked: Array<{ drawing_number: string; reasons: string[] }> = [];
    const snapshot: RevisionSnapshotEntry[] = [];
    for (const did of data.drawingIds) {
      const d = byId.get(did);
      if (!d) {
        missing.push(did);
        continue;
      }
      if (!d.eligible || !d.latest_ifd_revision_id) {
        blocked.push({
          drawing_number: d.drawing_number,
          reasons: d.reasons.length > 0 ? d.reasons : ["Not eligible."],
        });
        continue;
      }
      snapshot.push({
        drawing_id: d.drawing_id,
        revision_id: d.latest_ifd_revision_id,
        drawing_number: d.drawing_number,
        revision_code: d.latest_ifd_revision_code ?? "",
        discipline: d.discipline,
        title: d.title,
      });
    }

    if (missing.length > 0) {
      httpError(404, "drawings_not_found", `Missing drawings: ${missing.length}`);
    }
    if (blocked.length > 0) {
      throw Object.assign(new Error("ifc_prepare_blocked"), {
        statusCode: 409,
        body: JSON.stringify({
          error: "ifc_prepare_blocked",
          message: `${blocked.length} drawing(s) not eligible for IFC.`,
          blocked,
        }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const insertRow = {
      company_id: project.company_id,
      project_id: data.projectId,
      package_name: data.packageName,
      notes: data.notes ?? null,
      revision_snapshot: snapshot,
      distribution_list: data.distribution,
      status: "prepared" as const,
      prepared_by: context.user.id,
      created_by: context.user.id,
    };

    const { data: inserted, error: iErr } = await context.supabase
      .from("ifc_releases")
      .insert(insertRow as any)
      .select("id")
      .single();
    if (iErr) throw iErr;

    await audit(context, "engineering.ifc_prepared", (inserted as any).id, {
      project_id: data.projectId,
      package_name: data.packageName,
      drawing_count: snapshot.length,
    });

    return { id: (inserted as any).id as string };
  });

// ---------------------------------------------------------------------------
// signIfcRelease
// ---------------------------------------------------------------------------
const signInput = z.object({
  releaseId: z.string().uuid(),
  roleLabel: z.enum(IFC_SIGNOFF_ROLES),
  signatureText: z.string().trim().min(2).max(200),
});

export const signIfcRelease = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => signInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const release = await loadRelease(context, data.releaseId);
    await assertIfcAdmin(context, release.company_id);
    if (release.status !== "prepared") {
      httpError(409, "release_not_prepared", "Release is no longer in prepared state.");
    }

    // Verify typed name matches caller's profile name (or email fallback).
    const { data: profile, error: pErr } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.user.id)
      .maybeSingle();
    if (pErr) throw pErr;
    const known = ((profile as any)?.full_name ?? (profile as any)?.email ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const typed = data.signatureText.trim().toLowerCase();
    if (!known || typed !== known) {
      httpError(
        400,
        "signature_mismatch",
        "Typed name must match your profile's full name exactly.",
      );
    }

    const upsertRow = {
      company_id: release.company_id,
      release_id: data.releaseId,
      signer_id: context.user.id,
      role_label: data.roleLabel,
      signature_text: data.signatureText.trim(),
      signed_at: new Date().toISOString(),
    };

    const { error: uErr } = await context.supabase
      .from("ifc_release_signoffs")
      .upsert(upsertRow as any, { onConflict: "release_id,role_label" });
    if (uErr) {
      const msg = String((uErr as any).message ?? "");
      if (msg.includes("duplicate")) {
        httpError(409, "already_signed", "This role has already signed.");
      }
      throw uErr;
    }

    await audit(context, "engineering.ifc_signed", data.releaseId, {
      role_label: data.roleLabel,
      signer_id: context.user.id,
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// releaseIfc — locks drawings, sets IFC status, ticks the design_freeze
// checklist item on the Development gate, and emits engineering.ifc_released.
// ---------------------------------------------------------------------------
export const releaseIfc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ releaseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const release = await loadRelease(context, data.releaseId);
    await assertIfcAdmin(context, release.company_id);
    if (release.status !== "prepared") {
      httpError(409, "release_not_prepared", "Release must be in prepared state.");
    }

    const { data: signoffs, error: sErr } = await context.supabase
      .from("ifc_release_signoffs")
      .select("role_label, signer_id, signature_text, signed_at")
      .eq("release_id", data.releaseId);
    if (sErr) throw sErr;
    const signedRoles = new Set(((signoffs ?? []) as any[]).map((s) => s.role_label as string));
    const missing = REQUIRED_SIGNOFF_ROLES.filter((r) => !signedRoles.has(r));
    if (missing.length > 0) {
      httpError(409, "signoff_missing", `Missing sign-offs: ${missing.join(", ")}`);
    }

    const snapshot: RevisionSnapshotEntry[] = Array.isArray(release.revision_snapshot)
      ? (release.revision_snapshot as RevisionSnapshotEntry[])
      : [];

    const now = new Date().toISOString();

    // Lock each drawing and mark its snapshot revision as IFC.
    for (const entry of snapshot) {
      const { error: uRevErr } = await context.supabase
        .from("drawing_revisions")
        .update({ status: "IFC", issued_by: context.user.id, issued_at: now } as any)
        .eq("id", entry.revision_id);
      if (uRevErr) throw uRevErr;

      const { error: uDrErr } = await context.supabase
        .from("drawing_register")
        .update({
          current_status: "IFC",
          current_revision_id: entry.revision_id,
          locked: true,
          updated_at: now,
        } as any)
        .eq("id", entry.drawing_id);
      if (uDrErr) throw uDrErr;
    }

    // Update release row.
    const { error: relErr } = await context.supabase
      .from("ifc_releases")
      .update({
        status: "released",
        released_by: context.user.id,
        released_at: now,
      } as any)
      .eq("id", data.releaseId);
    if (relErr) throw relErr;

    // Tick the design_freeze checklist item on the project's Development gate.
    try {
      const { data: gate } = await context.supabase
        .from("project_phase_gates")
        .select("id, checklist, status")
        .eq("project_id", release.project_id)
        .eq("phase", "development")
        .maybeSingle();
      if (gate && (gate as any).status !== "closed") {
        const items: any[] = Array.isArray((gate as any).checklist) ? (gate as any).checklist : [];
        let changed = false;
        const nextList = items.map((it: any) => {
          const key = String(it?.key ?? "");
          const label = String(it?.label ?? it?.name ?? "");
          if (key === "design_freeze" || label === "Design freeze — IFC package released") {
            if (it?.done) return it;
            changed = true;
            return {
              key: "design_freeze",
              label: "Design freeze — IFC package released",
              required: true,
              done: true,
              done_by: context.user.id,
              done_at: now,
            };
          }
          return it;
        });
        if (changed) {
          await context.supabase
            .from("project_phase_gates")
            .update({ checklist: nextList } as any)
            .eq("id", (gate as any).id);
          await context.supabase.rpc("write_audit_log", {
            p_action: "gate.checklist_toggled",
            p_entity: "project_phase_gates",
            p_entity_id: (gate as any).id,
            p_metadata: {
              project_id: release.project_id,
              phase: "development",
              key: "design_freeze",
              done: true,
              source: "ifc_release",
              release_id: data.releaseId,
            },
          });
        }
      }
    } catch {
      // gate wiring is best-effort; release still succeeds
    }

    await audit(context, "engineering.ifc_released", data.releaseId, {
      project_id: release.project_id,
      package_name: release.package_name,
      revision_snapshot: snapshot,
      signers: (signoffs ?? []).map((s: any) => ({
        role_label: s.role_label,
        signer_id: s.signer_id,
        signature_text: s.signature_text,
        signed_at: s.signed_at,
      })),
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// voidIfcRelease — only allowed while prepared.
// ---------------------------------------------------------------------------
export const voidIfcRelease = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        releaseId: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const release = await loadRelease(context, data.releaseId);
    await assertIfcAdmin(context, release.company_id);
    if (release.status !== "prepared") {
      httpError(409, "release_not_prepared", "Only prepared releases can be voided.");
    }
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("ifc_releases")
      .update({
        status: "void",
        voided_by: context.user.id,
        voided_at: now,
        void_reason: data.reason,
      } as any)
      .eq("id", data.releaseId);
    if (error) throw error;

    await audit(context, "engineering.ifc_voided", data.releaseId, {
      reason: data.reason,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// notifyDistribution — inserts a notification row per recipient.
// ---------------------------------------------------------------------------
export const notifyDistribution = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ releaseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const release = await loadRelease(context, data.releaseId);
    await assertIfcAdmin(context, release.company_id);
    if (release.status !== "released") {
      httpError(409, "release_not_released", "Only released packages can notify recipients.");
    }
    const list: DistributionEntry[] = Array.isArray(release.distribution_list)
      ? (release.distribution_list as DistributionEntry[])
      : [];
    if (list.length === 0) return { sent: 0 };

    const rows = list.map((r) => ({
      company_id: release.company_id,
      user_id: r.profile_id,
      type: "ifc_released",
      title: `IFC package released: ${release.package_name}`,
      body: `An Issued for Construction package for your project is now available.`,
      link: `/projects/${release.project_id}/engineering/ifc-release/${release.id}/certificate`,
    }));

    const { error } = await context.supabase.from("notifications").insert(rows as any);
    if (error) throw error;

    await audit(context, "engineering.ifc_distributed", data.releaseId, {
      recipient_count: rows.length,
    });
    return { sent: rows.length };
  });

// ---------------------------------------------------------------------------
// getMyIfcRole — for gating UI actions.
// ---------------------------------------------------------------------------
export const getMyIfcRole = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      userId: string;
      isAdmin: boolean;
      fullName: string | null;
      email: string | null;
    }> => {
      requireSupabaseAuth(context);
      const project = await loadProjectCompany(context, data.projectId);
      const [admin, profile] = await Promise.all([
        isAdminOfCompany(context, project.company_id),
        context.supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", context.user.id)
          .maybeSingle(),
      ]);
      const p = (profile as any).data ?? null;
      return {
        userId: context.user.id,
        isAdmin: admin,
        fullName: p?.full_name ?? null,
        email: p?.email ?? null,
      };
    },
  );

// ---------------------------------------------------------------------------
// getIfcKpis — design cycle time + change-orders-after-IFC counter.
// ---------------------------------------------------------------------------
export interface IfcKpiResult {
  design_cycle_days: number | null;
  change_orders_after_ifc: number;
  released_count: number;
  latest_released_at: string | null;
}

export const getIfcKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<IfcKpiResult> => {
    requireSupabaseAuth(context);
    const [releasesRes, revsRes] = await Promise.all([
      context.supabase
        .from("ifc_releases")
        .select("id, status, released_at")
        .eq("project_id", data.projectId)
        .eq("status", "released")
        .order("released_at", { ascending: false }),
      context.supabase
        .from("drawing_revisions")
        .select(
          "id, drawing_id, status, created_at, drawing:drawing_register!inner(project_id, locked)",
        )
        .eq("drawing.project_id", data.projectId),
    ]);
    if (releasesRes.error) throw releasesRes.error;
    if (revsRes.error) throw revsRes.error;

    const released = (releasesRes.data ?? []) as any[];
    const revs = (revsRes.data ?? []) as any[];

    const latestReleasedAt = released[0]?.released_at ?? null;
    const firstIfd = revs
      .filter((r) => r.status === "IFD")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    let cycle: number | null = null;
    if (firstIfd && latestReleasedAt) {
      const ms = new Date(latestReleasedAt).getTime() - new Date(firstIfd.created_at).getTime();
      cycle = Math.max(0, Math.round(ms / 86_400_000));
    }

    const changes = revs.filter((r) => {
      const locked = (r.drawing as any)?.locked === true;
      if (!locked || !latestReleasedAt) return false;
      return new Date(r.created_at) > new Date(latestReleasedAt);
    }).length;

    return {
      design_cycle_days: cycle,
      change_orders_after_ifc: changes,
      released_count: released.length,
      latest_released_at: latestReleasedAt,
    };
  });
