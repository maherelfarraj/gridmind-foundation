// P-098 — Turnover pack server helpers (kept out of *.functions.ts to satisfy
// tanstack-serverfn-split; handlers import from here rather than declaring
// siblings in the same file).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildTurnoverIndexPdfBytes,
  type TurnoverPdfInput,
} from "@/lib/exports/turnover-index-pdf";
import {
  TURNOVER_SECTIONS,
  type TurnoverSection,
  type TurnoverSectionItem,
  type TurnoverSectionKey,
} from "@/lib/turnover.rules";

type Client = SupabaseClient<any, any, any>;

export interface TurnoverBranding {
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
}

export interface TurnoverProject {
  name: string;
  code: string | null;
}

export interface TurnoverCompany {
  name: string;
  legal_name: string | null;
}

// -----------------------------------------------------------------------------
// Storage helpers
// -----------------------------------------------------------------------------

// closeout is a private bucket: `{company_id}/turnover/{project_id}/...`
export function turnoverStoragePrefix(companyId: string, projectId: string, sub: string): string {
  return `${companyId}/turnover/${projectId}/${sub}`.replace(/\/+$/, "");
}

// Copy a file already stored inside another Supabase Storage bucket into
// closeout. The best-effort copy uses download → upload, since bucket-to-bucket
// server-side copy isn't part of the JS client surface we can rely on here.
export async function copyIntoCloseout(
  client: Client,
  sourceBucket: string,
  sourcePath: string,
  targetPath: string,
  mimeType: string | null,
): Promise<string | null> {
  try {
    const dl = await client.storage.from(sourceBucket).download(sourcePath);
    if (dl.error || !dl.data) return null;
    const bytes = await dl.data.arrayBuffer();
    const upload = await client.storage.from("closeout").upload(targetPath, bytes, {
      contentType: mimeType ?? dl.data.type ?? "application/octet-stream",
      upsert: true,
    });
    if (upload.error) return null;
    return targetPath;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Section collection
// -----------------------------------------------------------------------------

// Pull the current-revision as-built / IFC drawings for a project.
export async function collectAsBuiltItems(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<TurnoverSectionItem[]> {
  const { data: drawings } = await client
    .from("drawing_register")
    .select(
      "id, drawing_number, title, current_revision:drawing_revisions!drawing_register_current_revision_id_fkey(id, revision_code, status, storage_path, mime_type, issued_at)",
    )
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  const rows = ((drawings ?? []) as any[])
    .map((d) => ({
      drawingNumber: d.drawing_number as string,
      title: d.title as string,
      rev: d.current_revision as {
        id: string;
        revision_code: string | null;
        status: string | null;
        storage_path: string | null;
        mime_type: string | null;
        issued_at: string | null;
      } | null,
    }))
    .filter(
      (r) => r.rev && r.rev.storage_path && (r.rev.status === "as_built" || r.rev.status === "IFC"),
    );

  const items: TurnoverSectionItem[] = [];
  for (const r of rows) {
    const rev = r.rev!;
    const label = `${r.drawingNumber} — ${r.title}`;
    const targetPath = `${turnoverStoragePrefix(companyId, projectId, "as-built")}/${r.drawingNumber.replace(
      /[^A-Za-z0-9._-]/g,
      "_",
    )}_${rev.revision_code ?? "rev"}.pdf`;
    const copied = await copyIntoCloseout(
      client,
      "drawings",
      rev.storage_path!,
      targetPath,
      rev.mime_type ?? "application/pdf",
    );
    items.push({
      label,
      file_path: copied ?? rev.storage_path!,
      source: copied ? "drawing_register" : "drawing_register:external",
      revision: rev.revision_code ?? null,
      document_date: rev.issued_at ? rev.issued_at.slice(0, 10) : null,
    });
  }
  return items;
}

// Warranty docs: tag-filtered rows in the documents bucket.
export async function collectWarrantyItems(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<TurnoverSectionItem[]> {
  const { data } = await client
    .from("documents")
    .select("id, title, storage_path, tags, updated_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .contains("tags", ["warranty"] as any);
  return ((data ?? []) as any[]).map((d) => ({
    label: d.title as string,
    file_path: d.storage_path as string,
    source: "documents",
    revision: null,
    document_date: d.updated_at ? String(d.updated_at).slice(0, 10) : null,
  }));
}

// Commissioning witness files + performance report files.
export async function collectTestReportItems(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<TurnoverSectionItem[]> {
  const items: TurnoverSectionItem[] = [];

  const { data: ct } = await client
    .from("commissioning_tests")
    .select("id, area, equipment_ref, test_type, witness_file_path, completed_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .not("witness_file_path", "is", null);
  for (const r of (ct ?? []) as any[]) {
    items.push({
      label: `${r.test_type ?? "Test"} — ${r.area ?? ""} ${r.equipment_ref ?? ""}`.trim(),
      file_path: r.witness_file_path as string,
      source: "commissioning_tests",
      revision: null,
      document_date: r.completed_at ? String(r.completed_at).slice(0, 10) : null,
    });
  }

  const { data: pt } = await client
    .from("performance_tests")
    .select("id, report_file_path, completed_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .not("report_file_path", "is", null);
  for (const r of (pt ?? []) as any[]) {
    items.push({
      label: "Performance Ratio report",
      file_path: r.report_file_path as string,
      source: "performance_tests",
      revision: null,
      document_date: r.completed_at ? String(r.completed_at).slice(0, 10) : null,
    });
  }

  return items;
}

// Signed MC/COD certificate PDFs.
export async function collectCertificateItems(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<TurnoverSectionItem[]> {
  const { data } = await client
    .from("commissioning_certificates")
    .select("certificate_type, certificate_number, effective_date, signed_pdf_path, status")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("status", "signed")
    .not("signed_pdf_path", "is", null);
  return ((data ?? []) as any[]).map((r) => ({
    label: `${r.certificate_type === "cod" ? "COD" : r.certificate_type === "mechanical_completion" ? "Mechanical Completion" : "Care/Custody/Control"} — ${r.certificate_number}`,
    file_path: r.signed_pdf_path as string,
    source: "commissioning_certificates",
    revision: null,
    document_date: r.effective_date ?? null,
  }));
}

// -----------------------------------------------------------------------------
// PDF wrapper
// -----------------------------------------------------------------------------
export function renderTurnoverIndex(input: TurnoverPdfInput): Uint8Array {
  return buildTurnoverIndexPdfBytes(input);
}

// -----------------------------------------------------------------------------
// Section merge — preserve manual uploads across recompiles.
// -----------------------------------------------------------------------------
export function mergeSections(
  existing: TurnoverSection[] | null,
  freshBySection: Partial<Record<TurnoverSectionKey, TurnoverSectionItem[]>>,
): TurnoverSection[] {
  const base =
    existing && existing.length > 0
      ? existing
      : TURNOVER_SECTIONS.map((s) => ({ ...s, complete: false, items: [] }));
  return base.map((s) => {
    const fresh = freshBySection[s.key];
    if (fresh === undefined) {
      // Section not recomputed — keep existing items.
      const items = s.items ?? [];
      return { ...s, items, complete: items.length >= 1 };
    }
    // For as_builts / certificates / test_reports we replace with fresh copies
    // (source of truth is the domain table).
    // For om_manual / warranties we keep manual uploads and add fresh ones.
    if (s.key === "om_manual" || s.key === "warranties") {
      const seen = new Set(fresh.map((i) => i.file_path));
      const merged = [
        ...fresh,
        ...(s.items ?? []).filter((i) => i.source === "manual" && !seen.has(i.file_path)),
      ];
      return { ...s, items: merged, complete: merged.length >= 1 };
    }
    return { ...s, items: fresh, complete: fresh.length >= 1 };
  });
}
