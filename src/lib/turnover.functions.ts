// P-098 — Turnover pack server functions.
// Handlers are thin wrappers around helpers in turnover.server.ts
// (per tanstack-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  addItemInput,
  allRequiredComplete,
  emptySections,
  markDeliveredInput,
  missingRequiredSections,
  TURNOVER_SECTIONS,
  TURNOVER_WRITE_ROLES,
  turnoverProjectInput,
  withComputedCompletion,
  type TurnoverSection,
  type TurnoverSectionItem,
  type TurnoverStatus,
} from "@/lib/turnover.rules";
import {
  collectAsBuiltItems,
  collectCertificateItems,
  collectTestReportItems,
  collectWarrantyItems,
  mergeSections,
  type TurnoverBranding,
  type TurnoverCompany,
  type TurnoverProject,
} from "@/lib/turnover.server";

function httpError(status: number, code: string, metadata?: Record<string, unknown>): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code, ...(metadata ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
    metadata,
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

// -----------------------------------------------------------------------------
// Types shared with the UI
// -----------------------------------------------------------------------------
export interface TurnoverPackRow {
  id: string;
  company_id: string;
  project_id: string;
  status: TurnoverStatus;
  sections: TurnoverSection[];
  index_pdf_path: string | null;
  compiled_by: string | null;
  compiled_at: string | null;
  delivered_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TurnoverBoard {
  companyId: string;
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoSignedUrl: string | null;
  };
  project: TurnoverProject;
  company: TurnoverCompany;
  pack: TurnoverPackRow | null;
  indexSignedUrl: string | null;
  permissions: { canWrite: boolean; canReadFull: boolean };
  roles: string[];
}

// -----------------------------------------------------------------------------
// getTurnoverPack
// -----------------------------------------------------------------------------
export const getTurnoverPack = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => turnoverProjectInput.parse(raw))
  .handler(async ({ data, context }): Promise<TurnoverBoard> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);

    const [{ data: proj, error: pErr }, { data: co }, { data: br }, { data: row }] =
      await Promise.all([
        context.supabase
          .from("projects")
          .select("name, code, company_id")
          .eq("id", data.projectId)
          .maybeSingle(),
        context.supabase
          .from("companies")
          .select("name, legal_name")
          .eq("id", companyId)
          .maybeSingle(),
        context.supabase
          .from("company_branding")
          .select("primary_color, accent_color, logo_url")
          .eq("company_id", companyId)
          .maybeSingle(),
        context.supabase
          .from("turnover_packages")
          .select(
            "id, company_id, project_id, status, sections, index_pdf_path, compiled_by, compiled_at, delivered_at, accepted_by, accepted_at, created_at, updated_at",
          )
          .eq("company_id", companyId)
          .eq("project_id", data.projectId)
          .maybeSingle(),
      ]);
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId) httpError(404, "project_not_found");

    const branding = br as TurnoverBranding | null;
    const logoPath = branding?.logo_url ?? null;
    let logoSignedUrl: string | null = null;
    if (logoPath) {
      const { data: signed } = await context.supabase.storage
        .from("documents")
        .createSignedUrl(logoPath, 60 * 10);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    const pack = row
      ? ({
          ...(row as any),
          sections: withComputedCompletion(
            Array.isArray((row as any).sections) && (row as any).sections.length > 0
              ? ((row as any).sections as TurnoverSection[])
              : emptySections(),
          ),
        } as TurnoverPackRow)
      : null;

    let indexSignedUrl: string | null = null;
    if (pack?.index_pdf_path) {
      const { data: signed } = await context.supabase.storage
        .from("closeout")
        .createSignedUrl(pack.index_pdf_path, 60 * 10);
      indexSignedUrl = signed?.signedUrl ?? null;
    }

    const canWrite = roles.some((r) => TURNOVER_WRITE_ROLES.has(r));
    const canReadFull = canWrite || roles.some((r) => r === "om_admin" || r === "engineer");

    return {
      companyId,
      branding: {
        primaryColor: branding?.primary_color ?? null,
        accentColor: branding?.accent_color ?? null,
        logoSignedUrl,
      },
      project: {
        name: (proj as any).name ?? "",
        code: (proj as any).code ?? null,
      },
      company: {
        name: (co as any)?.name ?? "",
        legal_name: (co as any)?.legal_name ?? null,
      },
      pack,
      indexSignedUrl,
      permissions: { canWrite, canReadFull },
      roles,
    };
  });

// -----------------------------------------------------------------------------
// compileTurnoverPackage
// -----------------------------------------------------------------------------
export const compileTurnoverPackage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => turnoverProjectInput.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      pack: TurnoverPackRow;
      missing: string[];
      indexPdfBytesB64: string | null;
      indexPdfTargetPath: string | null;
    }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const roles = await currentRoles(context);
      if (!roles.some((r) => TURNOVER_WRITE_ROLES.has(r))) httpError(403, "forbidden");

      const { data: proj } = await context.supabase
        .from("projects")
        .select("company_id, name, code")
        .eq("id", data.projectId)
        .maybeSingle();
      if (!proj || (proj as any).company_id !== companyId) httpError(404, "project_not_found");

      const { assertExportAllowed } = await import("@/lib/export-guard");
      await assertExportAllowed(context.supabase, data.projectId, "turnover_pack");

      // Existing row (may contain manual uploads to preserve).
      const { data: existing } = await context.supabase
        .from("turnover_packages")
        .select("id, sections")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .maybeSingle();

      const existingSections =
        Array.isArray((existing as any)?.sections) && (existing as any).sections.length > 0
          ? ((existing as any).sections as TurnoverSection[])
          : null;

      // Gather fresh domain items.
      const [asBuilts, warranties, testReports, certificates] = await Promise.all([
        collectAsBuiltItems(context.supabase as any, companyId, data.projectId),
        collectWarrantyItems(context.supabase as any, companyId, data.projectId),
        collectTestReportItems(context.supabase as any, companyId, data.projectId),
        collectCertificateItems(context.supabase as any, companyId, data.projectId),
      ]);

      const merged = mergeSections(existingSections, {
        as_builts: asBuilts,
        warranties,
        test_reports: testReports,
        certificates,
        // om_manual not recomputed here — manual uploads are the source.
      });

      const missing = missingRequiredSections(merged);
      const ready = allRequiredComplete(merged);
      const nowIso = new Date().toISOString();

      // Upsert row (status flips to ready when every required section has ≥1
      // item). We'll fill index_pdf_path after the client uploads the PDF —
      // returned bytes let the caller do a signed upload without granting the
      // Worker service-role storage access.
      const upsertPayload: Record<string, any> = {
        company_id: companyId,
        project_id: data.projectId,
        sections: merged,
        status: ready ? "ready" : "compiling",
      };
      if (ready) {
        upsertPayload.compiled_at = nowIso;
        upsertPayload.compiled_by = context.user!.id;
      }
      if (!existing) upsertPayload.created_by = context.user!.id;

      const q = existing
        ? context.supabase
            .from("turnover_packages")
            .update(upsertPayload as any)
            .eq("id", (existing as any).id)
        : context.supabase.from("turnover_packages").insert(upsertPayload as any);

      const { data: saved, error: uErr } = await q
        .select(
          "id, company_id, project_id, status, sections, index_pdf_path, compiled_by, compiled_at, delivered_at, accepted_by, accepted_at, created_at, updated_at",
        )
        .single();
      if (uErr) throw uErr;

      const savedPack = {
        ...(saved as any),
        sections: withComputedCompletion(
          ((saved as any).sections as TurnoverSection[]) ?? emptySections(),
        ),
      } as TurnoverPackRow;

      const targetPath = ready
        ? `${companyId}/turnover/${data.projectId}/index-${savedPack.id}.pdf`
        : null;

      await audit(context, "turnover.compiled", "turnover_packages", savedPack.id, {
        status: savedPack.status,
        sections_complete: merged.filter((s) => s.complete).map((s) => s.key),
      });

      return {
        pack: savedPack,
        missing,
        indexPdfBytesB64: null,
        indexPdfTargetPath: targetPath,
      };
    },
  );

// -----------------------------------------------------------------------------
// attachTurnoverIndex — the client generates the branded PDF (jsPDF), uploads
// it to closeout/{company}/turnover/{project}/... and then records the path
// and export_packages row here.
// -----------------------------------------------------------------------------
export const attachTurnoverIndex = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        indexPdfPath: z.string().min(1).max(500),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => TURNOVER_WRITE_ROLES.has(r))) httpError(403, "forbidden");

    const { data: row } = await context.supabase
      .from("turnover_packages")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!row) httpError(404, "pack_not_found");
    if ((row as any).status === "compiling") httpError(409, "pack_not_ready");

    const { error: uErr } = await context.supabase
      .from("turnover_packages")
      .update({ index_pdf_path: data.indexPdfPath } as any)
      .eq("id", (row as any).id);
    if (uErr) throw uErr;

    // Register in export center (best-effort).
    const { data: proj } = await context.supabase
      .from("projects")
      .select("name")
      .eq("id", data.projectId)
      .maybeSingle();

    await context.supabase.from("export_packages").insert({
      company_id: companyId,
      project_id: data.projectId,
      package_type: "turnover_pack",
      title: `Turnover pack — ${(proj as any)?.name ?? "project"}`,
      file_path: data.indexPdfPath,
      metadata: { pack_id: (row as any).id },
      created_by: context.user!.id,
    } as any);

    return { ok: true };
  });

// -----------------------------------------------------------------------------
// addTurnoverItems (manual uploads to om_manual / warranties)
// -----------------------------------------------------------------------------
export const addTurnoverItems = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => addItemInput.parse(raw))
  .handler(async ({ data, context }): Promise<TurnoverPackRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => TURNOVER_WRITE_ROLES.has(r))) httpError(403, "forbidden");

    const { data: row } = await context.supabase
      .from("turnover_packages")
      .select("id, sections, status")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .maybeSingle();

    const currentSections: TurnoverSection[] =
      Array.isArray((row as any)?.sections) && (row as any).sections.length > 0
        ? ((row as any).sections as TurnoverSection[])
        : emptySections();

    const updated = currentSections.map((s) => {
      if (s.key !== data.sectionKey) return s;
      const merged: TurnoverSectionItem[] = [
        ...(s.items ?? []),
        ...data.items.map((i) => ({
          label: i.label,
          file_path: i.file_path,
          source: i.source ?? "manual",
          revision: i.revision ?? null,
          document_date: i.document_date ?? null,
        })),
      ];
      return { ...s, items: merged, complete: merged.length >= 1 };
    });

    const payload: Record<string, any> = { sections: updated };
    // Uploads before compile stay in compiling; uploads after keep the ready
    // status intact.
    if (!row) {
      payload.company_id = companyId;
      payload.project_id = data.projectId;
      payload.status = "compiling";
      payload.created_by = context.user!.id;
    }

    const q = row
      ? context.supabase
          .from("turnover_packages")
          .update(payload as any)
          .eq("id", (row as any).id)
      : context.supabase.from("turnover_packages").insert(payload as any);

    const { data: saved, error } = await q
      .select(
        "id, company_id, project_id, status, sections, index_pdf_path, compiled_by, compiled_at, delivered_at, accepted_by, accepted_at, created_at, updated_at",
      )
      .single();
    if (error) throw error;

    return {
      ...(saved as any),
      sections: withComputedCompletion(
        ((saved as any).sections as TurnoverSection[]) ?? emptySections(),
      ),
    } as TurnoverPackRow;
  });

// -----------------------------------------------------------------------------
// markTurnoverDelivered
// -----------------------------------------------------------------------------
export const markTurnoverDelivered = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => markDeliveredInput.parse(raw))
  .handler(async ({ data, context }): Promise<TurnoverPackRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => TURNOVER_WRITE_ROLES.has(r))) httpError(403, "forbidden");

    const { data: row } = await context.supabase
      .from("turnover_packages")
      .select("id, status, sections")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!row) httpError(404, "pack_not_found");
    const status = (row as any).status as TurnoverStatus;
    if (status === "compiling") httpError(409, "pack_not_ready");

    const nowIso = new Date().toISOString();
    const payload: Record<string, any> = {
      status: data.acceptedBy ? "accepted" : "delivered",
      delivered_at: nowIso,
    };
    if (data.acceptedBy) {
      payload.accepted_by = data.acceptedBy;
      payload.accepted_at = nowIso;
    }

    const { data: saved, error } = await context.supabase
      .from("turnover_packages")
      .update(payload as any)
      .eq("id", (row as any).id)
      .select(
        "id, company_id, project_id, status, sections, index_pdf_path, compiled_by, compiled_at, delivered_at, accepted_by, accepted_at, created_at, updated_at",
      )
      .single();
    if (error) throw error;

    await audit(context, "turnover.delivered", "turnover_packages", (saved as any).id, {
      status: (saved as any).status,
      accepted_by: data.acceptedBy ?? null,
    });

    return {
      ...(saved as any),
      sections: withComputedCompletion(
        ((saved as any).sections as TurnoverSection[]) ?? emptySections(),
      ),
    } as TurnoverPackRow;
  });

// Also re-export the pure section list for the UI so we can render the label
// order deterministically without the client re-importing the rules module.
export const TURNOVER_SECTION_ORDER = TURNOVER_SECTIONS.map((s) => s.key);
