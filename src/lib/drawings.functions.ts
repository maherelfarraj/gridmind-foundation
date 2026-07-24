// P-053 — Drawing register: server functions.
// All mutations RLS-scoped via attachSupabaseAuth + requireSupabaseAuth.
// Never uses the service role. Enforces IFC governance server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// Constants + types
// ---------------------------------------------------------------------------
export const DRAWINGS_BUCKET = "drawings";
export const DRAWING_MAX_BYTES = 50 * 1024 * 1024;
export const DRAWING_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".dwg",
  ".dxf",
  ".tif",
  ".tiff",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

export const DRAWING_DISCIPLINES = [
  "civil",
  "structural",
  "electrical",
  "mechanical",
  "scada_controls",
  "survey",
  "general",
] as const;
export type DrawingDiscipline = (typeof DRAWING_DISCIPLINES)[number];

export const DRAWING_STATUSES = [
  "draft",
  "IFD",
  "IFC",
  "as_built",
  "superseded",
] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

const WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;
const STATUS_TRANSITION_ROLES = [
  "engineering_admin",
  "project_admin",
  "super_admin",
] as const;
const SIGNOFF_DECIDE_ROLES = [
  "engineering_admin",
  "project_admin",
  "super_admin",
] as const;

export interface DrawingRow {
  id: string;
  project_id: string;
  company_id: string;
  drawing_number: string;
  title: string;
  discipline: DrawingDiscipline;
  current_status: DrawingStatus;
  current_revision_id: string | null;
  locked: boolean;
  updated_at: string;
  current_revision: {
    id: string;
    revision_code: string;
    status: DrawingStatus;
    issued_at: string | null;
  } | null;
}

export interface RevisionRow {
  id: string;
  drawing_id: string;
  revision_code: string;
  status: DrawingStatus;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  issue_reason: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  issued_by_profile: { full_name: string | null; email: string | null } | null;
  created_by_profile: { full_name: string | null; email: string | null } | null;
}

export interface MarkupRow {
  id: string;
  revision_id: string;
  reviewer_id: string | null;
  reviewer_org: string | null;
  page_number: number | null;
  annotation: {
    coords?: { x: number; y: number };
    color?: string;
    comment?: string;
    type?: string;
    [k: string]: any;
  };
  status: "open" | "accepted" | "rejected" | "resolved";
  resolution_note: string | null;
  created_at: string;
  reviewer: { full_name: string | null; email: string | null } | null;
}

export interface DrawingSignoffRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(0, 120) || "file";
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

async function loadProjectCompany(
  context: any,
  projectId: string,
): Promise<{ id: string; company_id: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string };
}

async function loadDrawingWithCompany(
  context: any,
  drawingId: string,
): Promise<{
  id: string;
  company_id: string;
  project_id: string;
  current_status: DrawingStatus;
  locked: boolean;
  drawing_number: string;
}> {
  const { data, error } = await context.supabase
    .from("drawing_register")
    .select(
      "id, company_id, project_id, current_status, locked, drawing_number",
    )
    .eq("id", drawingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "drawing_not_found");
  return data as any;
}

async function assertRole(
  context: any,
  companyId: string,
  roles: readonly string[],
) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", roles as any)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) httpError(403, "forbidden");
}

async function audit(
  context: any,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    // audit failure should never break the write
  }
}

function nextRevisionCode(existing: string[]): string {
  if (existing.length === 0) return "A";
  // Numeric scheme detection
  const allNumeric = existing.every((c) => /^\d+$/.test(c));
  if (allNumeric) {
    const max = Math.max(...existing.map((c) => parseInt(c, 10)));
    return String(max + 1);
  }
  // Letter scheme (A..Z, then AA..)
  const letters = existing
    .filter((c) => /^[A-Z]+$/.test(c))
    .sort((a, b) => (a.length === b.length ? a.localeCompare(b) : a.length - b.length));
  const last = letters[letters.length - 1] ?? "A";
  // Simple increment for A..Z; fall back to appending suffix.
  if (last.length === 1 && last < "Z") {
    return String.fromCharCode(last.charCodeAt(0) + 1);
  }
  if (last === "Z") return "AA";
  return last + "A";
}

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid(),
  search: z.string().trim().max(120).optional().nullable(),
  discipline: z.enum(DRAWING_DISCIPLINES).optional().nullable(),
  status: z.enum(DRAWING_STATUSES).optional().nullable(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

export const listDrawings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<{ rows: DrawingRow[]; total: number }> => {
    requireSupabaseAuth(context);
    let query = context.supabase
      .from("drawing_register")
      .select(
        `id, project_id, company_id, drawing_number, title, discipline,
         current_status, current_revision_id, locked, updated_at,
         current_revision:drawing_revisions!drawing_register_current_revision_id_fkey(
           id, revision_code, status, issued_at
         )`,
        { count: "exact" },
      )
      .eq("project_id", data.projectId)
      .order("drawing_number", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.discipline) query = query.eq("discipline", data.discipline);
    if (data.status) query = query.eq("current_status", data.status);
    if (data.search && data.search.length > 0) {
      const like = `%${data.search.replace(/[%_]/g, "")}%`;
      query = query.or(`drawing_number.ilike.${like},title.ilike.${like}`);
    }

    const { data: rows, error, count } = await query;
    if (error) throw error;
    return {
      rows: ((rows ?? []) as any[]).map((r) => ({
        ...r,
        current_revision: Array.isArray(r.current_revision)
          ? r.current_revision[0] ?? null
          : r.current_revision ?? null,
      })) as DrawingRow[],
      total: count ?? 0,
    };
  });

const getInput = z.object({ drawingId: z.string().uuid() });

export const getDrawing = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => getInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: drawing, error } = await context.supabase
      .from("drawing_register")
      .select(
        `id, project_id, company_id, drawing_number, title, discipline,
         current_status, current_revision_id, locked, updated_at, created_at`,
      )
      .eq("id", data.drawingId)
      .maybeSingle();
    if (error) throw error;
    if (!drawing) httpError(404, "drawing_not_found");

    const { data: revs, error: rErr } = await context.supabase
      .from("drawing_revisions")
      .select(
        `id, drawing_id, revision_code, status, storage_path, file_name,
         file_size_bytes, mime_type, issue_reason, issued_by, issued_at,
         created_by, created_at`,
      )
      .eq("drawing_id", data.drawingId)
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;

    const list = (revs ?? []) as any[];
    const uids = Array.from(
      new Set(
        list
          .flatMap((r) => [r.issued_by, r.created_by])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    let profiles: Record<string, { full_name: string | null; email: string | null }> = {};
    if (uids.length > 0) {
      const { data: ps } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uids);
      for (const p of (ps ?? []) as any[]) {
        profiles[p.id] = { full_name: p.full_name ?? null, email: p.email ?? null };
      }
    }

    const revisions: RevisionRow[] = list.map((r) => ({
      ...r,
      issued_by_profile: r.issued_by ? profiles[r.issued_by] ?? null : null,
      created_by_profile: r.created_by ? profiles[r.created_by] ?? null : null,
    }));

    return { drawing: drawing as any, revisions };
  });

// ---------------------------------------------------------------------------
// Create drawing
// ---------------------------------------------------------------------------
const createInput = z.object({
  projectId: z.string().uuid(),
  drawingNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  discipline: z.enum(DRAWING_DISCIPLINES),
});

export const createDrawing = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const { data: inserted, error } = await context.supabase
      .from("drawing_register")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        drawing_number: data.drawingNumber,
        title: data.title,
        discipline: data.discipline,
        created_by: context.user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "23505") {
        httpError(409, "drawing_number_taken", `Drawing number ${data.drawingNumber} already exists in this project.`);
      }
      throw error;
    }
    await audit(context, "drawing.created", "drawing_register", inserted!.id, {
      project_id: project.id,
      drawing_number: data.drawingNumber,
      discipline: data.discipline,
    });
    return { id: inserted!.id };
  });

// ---------------------------------------------------------------------------
// Revision upload (2-step)
// ---------------------------------------------------------------------------
const revUploadInput = z.object({
  drawingId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(DRAWING_MAX_BYTES, "File exceeds 50 MB limit"),
  mimeType: z.string().trim().max(200).optional().nullable(),
});

export const getRevisionUploadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => revUploadInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadDrawingWithCompany(context, data.drawingId);
    await assertRole(context, drawing.company_id, WRITE_ROLES);

    const ext = extOf(data.fileName);
    if (!DRAWING_ALLOWED_EXTENSIONS.includes(ext as any)) {
      httpError(400, "unsupported_extension");
    }
    if (drawing.locked) {
      httpError(409, "drawing_locked", "Drawing is locked (IFC/as-built). Create a superseded revision by transitioning the current one first.");
    }

    const { data: revs, error: rErr } = await context.supabase
      .from("drawing_revisions")
      .select("revision_code")
      .eq("drawing_id", drawing.id);
    if (rErr) throw rErr;
    const existing = ((revs ?? []) as any[]).map((r) => r.revision_code as string);
    const suggested = nextRevisionCode(existing);

    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeName = sanitizeFilename(data.fileName);
    const path = `${drawing.company_id}/${drawing.project_id}/drawings/${drawing.id}/${uuid}-${safeName}`;

    const { data: signed, error } = await context.supabase.storage
      .from(DRAWINGS_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw error;

    return {
      bucket: DRAWINGS_BUCKET,
      path,
      signedUrl: signed.signedUrl,
      token: signed.token,
      suggestedRevisionCode: suggested,
    };
  });

const registerRevInput = z.object({
  drawingId: z.string().uuid(),
  revisionCode: z.string().trim().min(1).max(10),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative().max(DRAWING_MAX_BYTES),
  mimeType: z.string().trim().max(200).optional().nullable(),
  issueReason: z.string().trim().max(500).optional().nullable(),
});

export const registerDrawingRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => registerRevInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadDrawingWithCompany(context, data.drawingId);
    await assertRole(context, drawing.company_id, WRITE_ROLES);

    const prefix = `${drawing.company_id}/${drawing.project_id}/drawings/${drawing.id}/`;
    if (!data.storagePath.startsWith(prefix)) {
      httpError(400, "path_mismatch");
    }

    const { data: inserted, error } = await context.supabase
      .from("drawing_revisions")
      .insert({
        company_id: drawing.company_id,
        drawing_id: drawing.id,
        revision_code: data.revisionCode,
        status: "draft",
        storage_path: data.storagePath,
        file_name: data.fileName,
        file_size_bytes: data.fileSize,
        mime_type: data.mimeType ?? null,
        issue_reason: data.issueReason ?? null,
        created_by: context.user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "23505") {
        httpError(409, "revision_code_taken", `Revision ${data.revisionCode} already exists.`);
      }
      throw error;
    }

    // Point drawing_register.current_revision_id → new revision (draft).
    await context.supabase
      .from("drawing_register")
      .update({ current_revision_id: inserted!.id, updated_at: new Date().toISOString() } as any)
      .eq("id", drawing.id);

    await audit(context, "drawing.revision_added", "drawing_revisions", inserted!.id, {
      drawing_id: drawing.id,
      revision_code: data.revisionCode,
      file_name: data.fileName,
      file_size_bytes: data.fileSize,
    });

    return { id: inserted!.id };
  });

// ---------------------------------------------------------------------------
// Status transition with IFC governance
// ---------------------------------------------------------------------------
const transitionInput = z.object({
  drawingId: z.string().uuid(),
  revisionId: z.string().uuid(),
  toStatus: z.enum(DRAWING_STATUSES),
});

const ALLOWED_TRANSITIONS: Record<DrawingStatus, DrawingStatus[]> = {
  draft: ["IFD", "superseded"],
  IFD: ["IFC", "draft", "superseded"],
  IFC: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

export const transitionDrawingStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => transitionInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadDrawingWithCompany(context, data.drawingId);
    await assertRole(context, drawing.company_id, STATUS_TRANSITION_ROLES);

    const { data: rev, error: rErr } = await context.supabase
      .from("drawing_revisions")
      .select("id, drawing_id, status, revision_code")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!rev || (rev as any).drawing_id !== drawing.id) {
      httpError(404, "revision_not_found");
    }

    const fromStatus = (rev as any).status as DrawingStatus;
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(data.toStatus)) {
      httpError(
        409,
        "invalid_transition",
        `Cannot transition from ${fromStatus} → ${data.toStatus}.`,
      );
    }

    // IFC governance: MUST rule #2 — IFD sign-off required.
    if (data.toStatus === "IFC") {
      // (1) at least one IFD revision exists on this drawing
      const { data: ifdRevs, error: iErr } = await context.supabase
        .from("drawing_revisions")
        .select("id")
        .eq("drawing_id", drawing.id)
        .eq("status", "IFD");
      if (iErr) throw iErr;
      if (!ifdRevs || ifdRevs.length === 0) {
        httpError(
          409,
          "ifc_requires_ifd_signoff",
          "IFC blocked — no IFD revision on record. Issue an IFD revision, resolve all markups, and log CFO/engineering sign-off first.",
        );
      }

      // (2) no open/rejected markups on any revision of this drawing
      const allRevIds = [
        ...((ifdRevs ?? []) as any[]).map((r) => r.id),
        rev.id,
      ];
      const { data: openMarkups, error: mErr } = await context.supabase
        .from("document_markups")
        .select("id, status")
        .in("revision_id", allRevIds)
        .in("status", ["open", "rejected"]);
      if (mErr) throw mErr;
      if ((openMarkups ?? []).length > 0) {
        httpError(
          409,
          "ifc_requires_ifd_signoff",
          `IFC blocked — ${(openMarkups ?? []).length} markup(s) still open/rejected. Resolve or accept every markup before promoting to IFC.`,
        );
      }

      // (3) approval_instances row for this drawing must exist and be approved
      const { data: signoffs, error: sErr } = await context.supabase
        .from("approval_instances")
        .select("id, status")
        .eq("entity", "drawing")
        .eq("entity_id", drawing.id)
        .eq("status", "approved")
        .limit(1);
      if (sErr) throw sErr;
      if (!signoffs || signoffs.length === 0) {
        httpError(
          409,
          "ifc_requires_ifd_signoff",
          "IFC blocked — no approved engineering sign-off recorded. Request sign-off and have engineering_admin/project_admin approve it first.",
        );
      }
    }

    const now = new Date().toISOString();
    const nextRevisionUpdate: Record<string, any> = { status: data.toStatus };
    if (data.toStatus === "IFD" || data.toStatus === "IFC" || data.toStatus === "as_built") {
      nextRevisionUpdate.issued_by = context.user.id;
      nextRevisionUpdate.issued_at = now;
    }

    const { error: uErr } = await context.supabase
      .from("drawing_revisions")
      .update(nextRevisionUpdate as any)
      .eq("id", rev.id);
    if (uErr) throw uErr;

    const locked = data.toStatus === "IFC" || data.toStatus === "as_built";
    const { error: dErr } = await context.supabase
      .from("drawing_register")
      .update({
        current_status: data.toStatus,
        current_revision_id: rev.id,
        locked,
        updated_at: now,
      } as any)
      .eq("id", drawing.id);
    if (dErr) throw dErr;

    // Audit trigger on drawing_revisions writes drawing_revision.status_changed;
    // we also emit drawing.status_changed at the register level.
    await audit(
      context,
      "drawing.status_changed",
      "drawing_register",
      drawing.id,
      {
        from: fromStatus,
        to: data.toStatus,
        revision_id: rev.id,
        revision_code: (rev as any).revision_code,
      },
    );

    return { ok: true, toStatus: data.toStatus, revisionId: rev.id };
  });

// ---------------------------------------------------------------------------
// Sign-off workflow (approval_instances entity='drawing')
// ---------------------------------------------------------------------------
export const listDrawingSignoffs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => getInput.parse(input))
  .handler(async ({ data, context }): Promise<DrawingSignoffRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("approval_instances")
      .select(
        "id, status, requested_by, decided_by, decided_at, metadata, created_at",
      )
      .eq("entity", "drawing")
      .eq("entity_id", data.drawingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as DrawingSignoffRow[];
  });

const requestSignoffInput = z.object({
  drawingId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const requestDrawingSignoff = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => requestSignoffInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadDrawingWithCompany(context, data.drawingId);
    await assertRole(context, drawing.company_id, WRITE_ROLES);

    // No duplicate pending
    const { data: existing } = await context.supabase
      .from("approval_instances")
      .select("id")
      .eq("entity", "drawing")
      .eq("entity_id", drawing.id)
      .eq("status", "pending")
      .limit(1);
    if (existing && existing.length > 0) {
      httpError(409, "signoff_pending", "A sign-off request is already pending.");
    }

    const { data: inserted, error } = await context.supabase
      .from("approval_instances")
      .insert({
        company_id: drawing.company_id,
        entity: "drawing",
        entity_id: drawing.id,
        status: "pending",
        requested_by: context.user.id,
        metadata: { note: data.note ?? null, drawing_number: drawing.drawing_number },
      } as any)
      .select("id")
      .single();
    if (error) throw error;

    await audit(context, "drawing.signoff_requested", "approval_instances", inserted!.id, {
      drawing_id: drawing.id,
    });

    return { id: inserted!.id };
  });

const decideSignoffInput = z.object({
  instanceId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(1000).optional().nullable(),
});

export const decideDrawingSignoff = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => decideSignoffInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { data: inst, error: iErr } = await context.supabase
      .from("approval_instances")
      .select("id, company_id, entity, entity_id, status")
      .eq("id", data.instanceId)
      .maybeSingle();
    if (iErr) throw iErr;
    if (!inst || (inst as any).entity !== "drawing") {
      httpError(404, "signoff_not_found");
    }
    if ((inst as any).status !== "pending") {
      httpError(409, "signoff_already_decided");
    }

    await assertRole(context, (inst as any).company_id, SIGNOFF_DECIDE_ROLES);

    const now = new Date().toISOString();
    const { error: uErr } = await context.supabase
      .from("approval_instances")
      .update({
        status: data.decision,
        decided_by: context.user.id,
        decided_at: now,
      } as any)
      .eq("id", data.instanceId);
    if (uErr) throw uErr;

    await context.supabase.from("approvals").insert({
      company_id: (inst as any).company_id,
      instance_id: data.instanceId,
      approver_id: context.user.id,
      status: data.decision,
      comment: data.comment ?? null,
      decided_at: now,
    } as any);

    await audit(context, "drawing.signoff_decided", "approval_instances", data.instanceId, {
      drawing_id: (inst as any).entity_id,
      decision: data.decision,
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Markups
// ---------------------------------------------------------------------------
const listMarkupsInput = z.object({ revisionId: z.string().uuid() });

export const listMarkups = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listMarkupsInput.parse(input))
  .handler(async ({ data, context }): Promise<MarkupRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("document_markups")
      .select(
        "id, revision_id, reviewer_id, reviewer_org, page_number, annotation, status, resolution_note, created_at",
      )
      .eq("revision_id", data.revisionId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const list = (rows ?? []) as any[];
    const uids = Array.from(
      new Set(list.map((r) => r.reviewer_id).filter(Boolean) as string[]),
    );
    let profiles: Record<string, { full_name: string | null; email: string | null }> = {};
    if (uids.length > 0) {
      const { data: ps } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uids);
      for (const p of (ps ?? []) as any[]) {
        profiles[p.id] = { full_name: p.full_name ?? null, email: p.email ?? null };
      }
    }
    return list.map((r) => ({
      ...r,
      reviewer: r.reviewer_id ? profiles[r.reviewer_id] ?? null : null,
    }));
  });

const createMarkupInput = z.object({
  revisionId: z.string().uuid(),
  pageNumber: z.number().int().min(1).max(10000).default(1),
  reviewerOrg: z.enum(["client", "lender", "utility", "internal"]).default("internal"),
  annotation: z.object({
    coords: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
    color: z.string().max(20).optional(),
    comment: z.string().trim().max(2000).default(""),
    type: z.string().max(40).default("pin"),
  }),
});

export const createMarkup = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createMarkupInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    // Look up company via revision → drawing
    const { data: rev, error: rErr } = await context.supabase
      .from("drawing_revisions")
      .select("id, company_id, drawing_id")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!rev) httpError(404, "revision_not_found");

    const { data: inserted, error } = await context.supabase
      .from("document_markups")
      .insert({
        company_id: (rev as any).company_id,
        revision_id: data.revisionId,
        reviewer_id: context.user.id,
        reviewer_org: data.reviewerOrg,
        page_number: data.pageNumber,
        annotation: data.annotation as any,
        status: "open",
      } as any)
      .select("id")
      .single();
    if (error) throw error;

    await audit(context, "drawing.markup_added", "document_markups", inserted!.id, {
      drawing_id: (rev as any).drawing_id,
      revision_id: data.revisionId,
    });

    return { id: inserted!.id };
  });

const updateMarkupInput = z.object({
  markupId: z.string().uuid(),
  status: z.enum(["open", "accepted", "rejected", "resolved"]),
  resolutionNote: z.string().trim().max(1000).optional().nullable(),
});

export const updateMarkupStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateMarkupInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: existing, error: eErr } = await context.supabase
      .from("document_markups")
      .select("id, status, revision_id")
      .eq("id", data.markupId)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!existing) httpError(404, "markup_not_found");

    const prev = (existing as any).status;
    const { error } = await context.supabase
      .from("document_markups")
      .update({
        status: data.status,
        resolution_note: data.resolutionNote ?? null,
      } as any)
      .eq("id", data.markupId);
    if (error) throw error;

    await audit(context, "drawing.markup_status_changed", "document_markups", data.markupId, {
      from: prev,
      to: data.status,
      revision_id: (existing as any).revision_id,
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Signed download for a revision file
// ---------------------------------------------------------------------------
export const getRevisionDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ revisionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rev, error } = await context.supabase
      .from("drawing_revisions")
      .select("id, storage_path, mime_type, file_name")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (error) throw error;
    if (!rev) httpError(404, "revision_not_found");

    const { data: signed, error: sErr } = await context.supabase.storage
      .from(DRAWINGS_BUCKET)
      .createSignedUrl((rev as any).storage_path, 60 * 15);
    if (sErr) throw sErr;

    return {
      url: signed.signedUrl,
      mimeType: (rev as any).mime_type as string | null,
      fileName: (rev as any).file_name as string | null,
    };
  });

// ---------------------------------------------------------------------------
// Current-user role helper (drives read-only UI gating)
// ---------------------------------------------------------------------------
export const getMyDrawingRoles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("company_id", project.company_id);
    if (error) throw error;
    const roles = ((rows ?? []) as any[]).map((r) => r.role as string);
    const canWrite = roles.some((r) => (WRITE_ROLES as readonly string[]).includes(r));
    const canTransition = roles.some((r) =>
      (STATUS_TRANSITION_ROLES as readonly string[]).includes(r),
    );
    const canDecideSignoff = roles.some((r) =>
      (SIGNOFF_DECIDE_ROLES as readonly string[]).includes(r),
    );
    return { roles, canWrite, canTransition, canDecideSignoff, companyId: project.company_id };
  });
