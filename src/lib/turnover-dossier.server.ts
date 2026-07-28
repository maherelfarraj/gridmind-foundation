// P-267 — Turnover dossier collectors (server-only; kept out of *.functions.ts
// per the server-fn splitting doctrine).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DOSSIER_CHAPTERS,
  GAP_REASON,
  type DossierChapter,
  type DossierItem,
} from "@/lib/turnover-dossier.rules";

type Client = SupabaseClient<any, any, any>;

const IFC_LOCKED = new Set(["IFC", "as_built"]);

async function collectAsBuilts(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<DossierItem[]> {
  const { data } = await client
    .from("drawing_register")
    .select(
      "id, drawing_number, title, locked, current_status, current_revision:drawing_revisions!drawing_register_current_revision_id_fkey(revision_code, status, issued_at)",
    )
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  return ((data ?? []) as any[]).map((d) => {
    const rev = d.current_revision as {
      revision_code: string | null;
      status: string | null;
      issued_at: string | null;
    } | null;
    const status = rev?.status ?? d.current_status ?? null;
    const ifcLocked = Boolean(status && IFC_LOCKED.has(status));
    return {
      reference: d.drawing_number as string,
      title: d.title as string,
      revision: rev?.revision_code ?? null,
      status,
      documentDate: rev?.issued_at ? String(rev.issued_at).slice(0, 10) : null,
      gapReason: ifcLocked ? null : GAP_REASON.drawingNotIfc,
    } satisfies DossierItem;
  });
}

async function collectItps(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<DossierItem[]> {
  const { data } = await client
    .from("inspection_test_plans")
    .select("id, itp_number, title, revision, status, approved_at, itp_steps(id, status)")
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  return ((data ?? []) as any[]).map((itp) => {
    const steps = (itp.itp_steps ?? []) as Array<{ status: string | null }>;
    const openSteps = steps.filter((s) => s.status !== "signed_off" && s.status !== "closed");
    const signedOff = steps.length > 0 && openSteps.length === 0;
    return {
      reference: itp.itp_number as string,
      title: itp.title as string,
      revision: itp.revision ?? null,
      status: itp.status ?? null,
      documentDate: itp.approved_at ? String(itp.approved_at).slice(0, 10) : null,
      gapReason: signedOff ? null : GAP_REASON.itpNoSignoff,
    } satisfies DossierItem;
  });
}

async function collectCertificates(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<DossierItem[]> {
  const { data } = await client
    .from("commissioning_certificates")
    .select("id, certificate_number, certificate_type, status, effective_date, signed_pdf_path")
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  return ((data ?? []) as any[]).map((c) => ({
    reference: (c.certificate_number as string) ?? "—",
    title: String(c.certificate_type ?? "Certificate"),
    revision: null,
    status: c.status ?? null,
    documentDate: c.effective_date ? String(c.effective_date).slice(0, 10) : null,
    gapReason: c.signed_pdf_path ? null : GAP_REASON.certUnsigned,
  }));
}

async function collectTaggedDocuments(
  client: Client,
  companyId: string,
  projectId: string,
  tag: string,
): Promise<DossierItem[]> {
  const { data } = await client
    .from("documents")
    .select("id, title, tags, updated_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .contains("tags", [tag] as any);

  return ((data ?? []) as any[]).map((d) => ({
    reference: tag === "warranty" ? "WARRANTY" : "O&M",
    title: d.title as string,
    revision: null,
    status: "issued",
    documentDate: d.updated_at ? String(d.updated_at).slice(0, 10) : null,
    gapReason: null,
  }));
}

async function collectCompliance(client: Client, companyId: string): Promise<DossierItem[]> {
  const { data } = await client
    .from("subcontract_compliance_docs")
    .select("id, doc_type, title, reference, status, expiry_date")
    .eq("company_id", companyId);

  return ((data ?? []) as any[]).map((d) => ({
    reference: (d.reference as string) ?? String(d.doc_type),
    title: d.title as string,
    revision: null,
    status: d.status ?? null,
    documentDate: d.expiry_date ? String(d.expiry_date).slice(0, 10) : null,
    gapReason: d.status === "expired" ? GAP_REASON.complianceExpired : null,
  }));
}

async function collectRegisterIndex(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<DossierItem[]> {
  const { data } = await client
    .from("document_register")
    .select("id, doc_number, title, current_revision, status, retention_class, updated_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("doc_number", { ascending: true });

  return ((data ?? []) as any[]).map((d) => ({
    reference: (d.doc_number as string) ?? "—",
    title: d.title as string,
    revision: d.current_revision ?? null,
    status: `${d.status} · ${d.retention_class}`,
    documentDate: d.updated_at ? String(d.updated_at).slice(0, 10) : null,
    gapReason: null,
  }));
}

export async function compileDossierChapters(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<DossierChapter[]> {
  const [asBuilts, itps, certs, om, warranties, compliance, index] = await Promise.all([
    collectAsBuilts(client, companyId, projectId),
    collectItps(client, companyId, projectId),
    collectCertificates(client, companyId, projectId),
    collectTaggedDocuments(client, companyId, projectId, "om_manual"),
    collectTaggedDocuments(client, companyId, projectId, "warranty"),
    collectCompliance(client, companyId),
    collectRegisterIndex(client, companyId, projectId),
  ]);

  const byKey: Record<string, DossierItem[]> = {
    as_builts: asBuilts,
    itp_records: itps,
    test_certificates: certs,
    om_manuals: om,
    warranties,
    compliance,
    register_index: index,
  };

  return DOSSIER_CHAPTERS.map((meta) => ({
    key: meta.key,
    title: meta.title,
    required: meta.required,
    items: byKey[meta.key] ?? [],
  }));
}
