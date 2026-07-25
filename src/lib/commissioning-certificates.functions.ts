// P-097 — MC + COD certificate server functions.
// Rules live in commissioning-certificates.rules.ts.
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  addSignatureInput,
  allSigned,
  attachPdfInput,
  CERT_PREFIX,
  CERT_TYPES,
  issueCertInput,
  isPassingPr,
  listCertsInput,
  missingCertParties,
  REQUIRED_PARTIES,
  suggestCertNumber,
  type CertificateStatus,
  type CertificateType,
  type CertParty,
  type CertSignature,
} from "@/lib/commissioning-certificates.rules";

function httpError(
  status: number,
  code: string,
  metadata?: Record<string, unknown>,
): never {
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

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export interface CommissioningCertificateRow {
  id: string;
  company_id: string;
  project_id: string;
  certificate_type: CertificateType;
  certificate_number: string;
  status: CertificateStatus;
  effective_date: string | null;
  pr_at_cod: number | null;
  payload: Record<string, any>;
  signatures: CertSignature[];
  signed_pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificatesBoard {
  companyId: string;
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoSignedUrl: string | null;
  };
  project: { name: string; code: string | null };
  company: { name: string; legalName: string | null };
  suggestedNumbers: Record<CertificateType, string>;
  rows: CommissioningCertificateRow[];
  permissions: { canIssue: boolean; canSign: boolean };
}

const WRITE_ROLES = new Set([
  "construction_admin",
  "project_admin",
  "company_admin",
]);

// ---------------------------------------------------------------------------
// listCertificates
// ---------------------------------------------------------------------------
export const listCertificates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listCertsInput.parse(raw))
  .handler(async ({ data, context }): Promise<CertificatesBoard> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);

    const [
      { data: rows, error: rErr },
      { data: proj, error: pErr },
      { data: existing },
      { data: co },
      { data: br },
    ] = await Promise.all([
      context.supabase
        .from("commissioning_certificates")
        .select(
          "id, company_id, project_id, certificate_type, certificate_number, status, effective_date, pr_at_cod, payload, signatures, signed_pdf_path, created_at, updated_at",
        )
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("projects")
        .select("name, code, company_id")
        .eq("id", data.projectId)
        .maybeSingle(),
      context.supabase
        .from("commissioning_certificates")
        .select("certificate_number")
        .eq("company_id", companyId),
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
    ]);
    if (rErr) throw rErr;
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(404, "project_not_found");

    const existingNumbers = ((existing ?? []) as { certificate_number: string }[]).map(
      (r) => r.certificate_number,
    );

    const suggestedNumbers = {
      mechanical_completion: suggestCertNumber(
        "mechanical_completion",
        existingNumbers,
      ),
      cod: suggestCertNumber("cod", existingNumbers),
      ccc_transfer: suggestCertNumber("ccc_transfer", existingNumbers),
    } as Record<CertificateType, string>;

    // Signed logo URL for PDFs (from documents bucket, matching PR report flow).
    const logoPath = (br as any)?.logo_url ?? null;
    let logoSignedUrl: string | null = null;
    if (logoPath) {
      const { data: signed } = await context.supabase.storage
        .from("documents")
        .createSignedUrl(logoPath, 60 * 10);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    const canWrite = roles.some((r) => WRITE_ROLES.has(r));

    return {
      companyId,
      branding: {
        primaryColor: (br as any)?.primary_color ?? null,
        accentColor: (br as any)?.accent_color ?? null,
        logoSignedUrl,
      },
      project: {
        name: (proj as any).name ?? "",
        code: (proj as any).code ?? null,
      },
      company: {
        name: (co as any)?.name ?? "",
        legalName: (co as any)?.legal_name ?? null,
      },
      suggestedNumbers,
      rows: ((rows ?? []) as any[]).map((r) => ({
        ...r,
        signatures: Array.isArray(r.signatures) ? r.signatures : [],
        payload: r.payload ?? {},
      })) as CommissioningCertificateRow[],
      permissions: { canIssue: canWrite, canSign: canWrite },
    };
  });

// ---------------------------------------------------------------------------
// issueCertificate
// ---------------------------------------------------------------------------
export const issueCertificate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => issueCertInput.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string; row: CommissioningCertificateRow }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const roles = await currentRoles(context);
      if (!roles.some((r) => WRITE_ROLES.has(r))) httpError(403, "forbidden");

      const { data: proj } = await context.supabase
        .from("projects")
        .select("company_id")
        .eq("id", data.projectId)
        .maybeSingle();
      if (!proj || (proj as any).company_id !== companyId)
        httpError(404, "project_not_found");

      // Ensure number begins with the correct prefix.
      const prefix = CERT_PREFIX[data.type];
      const normalizedNumber = data.certificateNumber.trim();
      if (!normalizedNumber.startsWith(prefix)) {
        httpError(400, "bad_certificate_number_prefix", { expected: prefix });
      }

      const { data: inserted, error } = await context.supabase
        .from("commissioning_certificates")
        .insert({
          company_id: companyId,
          project_id: data.projectId,
          certificate_type: data.type,
          certificate_number: normalizedNumber,
          status: "pending_signatures",
          effective_date: data.effectiveDate,
          payload: { scope_notes: data.scopeNotes ?? "" },
          signatures: [],
          created_by: context.user!.id,
        })
        .select(
          "id, company_id, project_id, certificate_type, certificate_number, status, effective_date, pr_at_cod, payload, signatures, signed_pdf_path, created_at, updated_at",
        )
        .single();

      if (error) {
        if ((error as any).code === "23505") {
          httpError(409, "certificate_already_exists", { type: data.type });
        }
        throw error;
      }

      const row = {
        ...(inserted as any),
        signatures: [],
        payload: (inserted as any).payload ?? {},
      } as CommissioningCertificateRow;

      await audit(context, "certificate.issued", "commissioning_certificates", row.id, {
        certificate_type: row.certificate_type,
        certificate_number: row.certificate_number,
        effective_date: row.effective_date,
        project_id: row.project_id,
      });

      return { id: row.id, row };
    },
  );

// ---------------------------------------------------------------------------
// addSignature — appends signature, applies COD guards, flips status
// ---------------------------------------------------------------------------
interface AddSignatureResult {
  row: CommissioningCertificateRow;
  closed: boolean;
  missing: CertParty[];
  gate: { requested: boolean; message?: string };
}

async function fetchOpenACount(
  context: AuthContext,
  companyId: string,
  projectId: string,
): Promise<{ open_count: number; item_refs: string[] }> {
  const { data, error } = await context.supabase
    .from("qaqc_punch_items")
    .select("id, punch_number")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("category", "A")
    .neq("status", "closed")
    .neq("status", "void");
  if (error) throw error;
  const items = (data ?? []) as { id: string; punch_number: string }[];
  return {
    open_count: items.length,
    item_refs: items.map((i) => i.punch_number),
  };
}

async function fetchPrPassing(
  context: AuthContext,
  companyId: string,
  projectId: string,
): Promise<{ passing: boolean; maxMeasured: number | null }> {
  const { data, error } = await context.supabase
    .from("performance_tests")
    .select("measured_value, contract_value, status")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("test_type", "performance_ratio")
    .eq("status", "complete");
  if (error) throw error;
  const rows = (data ?? []) as {
    measured_value: number | null;
    contract_value: number | null;
    status: string;
  }[];
  let passing = false;
  let maxMeasured: number | null = null;
  for (const r of rows) {
    const m = r.measured_value != null ? Number(r.measured_value) : null;
    const c = r.contract_value != null ? Number(r.contract_value) : null;
    if (m != null && (maxMeasured == null || m > maxMeasured)) maxMeasured = m;
    if (isPassingPr(m, c)) passing = true;
  }
  return { passing, maxMeasured };
}

async function requestCodGate(
  context: AuthContext,
  companyId: string,
  projectId: string,
): Promise<{ requested: boolean; message?: string }> {
  // Look up the COD gate for this project.
  const { data: gate } = await context.supabase
    .from("project_phase_gates")
    .select("id, phase, status, checklist")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("phase", "cod")
    .maybeSingle();
  if (!gate) return { requested: false, message: "no_cod_gate" };
  if ((gate as any).status !== "open") {
    return { requested: false, message: "gate_not_open" };
  }

  const { data: inst, error: iErr } = await context.supabase
    .from("approval_instances")
    .insert({
      company_id: companyId,
      entity: "project_phase_gate",
      entity_id: (gate as any).id,
      requested_by: context.user!.id,
      metadata: { project_id: projectId, phase: "cod", trigger: "cod_certificate" },
    })
    .select("id")
    .single();
  if (iErr) return { requested: false, message: "approval_instance_failed" };

  const { data: admins } = await context.supabase
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", "company_admin");
  const approverIds = Array.from(
    new Set(((admins ?? []) as { user_id: string }[]).map((r) => r.user_id)),
  );
  if (approverIds.length === 0) {
    return { requested: false, message: "no_approvers" };
  }

  const { error: apErr } = await context.supabase.from("approvals").insert(
    approverIds.map((uid) => ({
      company_id: companyId,
      instance_id: (inst as any).id,
      approver_id: uid,
    })),
  );
  if (apErr) return { requested: false, message: "approvals_failed" };

  const { error: upErr } = await context.supabase
    .from("project_phase_gates")
    .update({
      status: "in_review",
      approval_instance_id: (inst as any).id,
    })
    .eq("id", (gate as any).id);
  if (upErr) return { requested: false, message: "gate_update_failed" };

  await audit(context, "gate.transition_requested", "project_phase_gates", (gate as any).id, {
    project_id: projectId,
    phase: "cod",
    approval_instance_id: (inst as any).id,
    trigger: "cod_certificate",
  });

  return { requested: true };
}

export const addSignature = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => addSignatureInput.parse(raw))
  .handler(async ({ data, context }): Promise<AddSignatureResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => WRITE_ROLES.has(r))) httpError(403, "forbidden");

    const { data: current, error: cErr } = await context.supabase
      .from("commissioning_certificates")
      .select(
        "id, company_id, project_id, certificate_type, certificate_number, status, effective_date, pr_at_cod, payload, signatures, signed_pdf_path, created_at, updated_at",
      )
      .eq("id", data.certificateId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!current) httpError(404, "certificate_not_found");
    if ((current as any).company_id !== companyId) httpError(404, "certificate_not_found");
    if ((current as any).status === "signed" || (current as any).status === "void")
      httpError(409, "certificate_locked");

    const type = (current as any).certificate_type as CertificateType;
    const existing = Array.isArray((current as any).signatures)
      ? ((current as any).signatures as CertSignature[])
      : [];
    if (existing.some((s) => s.party === data.party))
      httpError(409, "party_already_signed", { party: data.party });
    if (!REQUIRED_PARTIES[type].includes(data.party))
      httpError(400, "party_not_required", { type, party: data.party });

    const nowIso = new Date().toISOString();
    const nextSignature: CertSignature = {
      party: data.party,
      name: data.name.trim(),
      title: data.title.trim(),
      signed_at: nowIso,
      file_path: data.filePath,
    };
    const nextSignatures = [...existing, nextSignature];
    const closed = allSigned(type, nextSignatures);
    const missing = missingCertParties(type, nextSignatures);

    let payload = (current as any).payload ?? {};
    let prAtCod: number | null = (current as any).pr_at_cod ?? null;
    let gate: { requested: boolean; message?: string } = { requested: false };

    if (closed && type === "cod") {
      // COD guards.
      const openA = await fetchOpenACount(context, companyId, (current as any).project_id);
      if (openA.open_count > 0) {
        httpError(409, "open_category_a_punch", openA);
      }
      const pr = await fetchPrPassing(context, companyId, (current as any).project_id);
      if (!pr.passing) {
        httpError(409, "no_passing_pr_test");
      }

      // Snapshot punch summary counts.
      const { data: punchRows } = await context.supabase
        .from("qaqc_punch_items")
        .select("category, status")
        .eq("company_id", companyId)
        .eq("project_id", (current as any).project_id);
      const summary = { A: { open: 0, closed: 0 }, B: { open: 0, closed: 0 }, C: { open: 0, closed: 0 } } as Record<
        "A" | "B" | "C",
        { open: number; closed: number }
      >;
      for (const r of (punchRows ?? []) as { category: "A" | "B" | "C"; status: string }[]) {
        const b = summary[r.category];
        if (!b) continue;
        if (r.status === "closed") b.closed += 1;
        else if (r.status !== "void") b.open += 1;
      }
      payload = {
        ...payload,
        punch_summary: summary,
        cod_snapshot_at: nowIso,
      };
      prAtCod = pr.maxMeasured;
    }

    const updates: Record<string, any> = {
      signatures: nextSignatures,
      payload,
    };
    if (closed) updates.status = "signed";
    if (closed && type === "cod") updates.pr_at_cod = prAtCod;

    const { data: updated, error: uErr } = await context.supabase
      .from("commissioning_certificates")
      .update(updates as any)
      .eq("id", (current as any).id)
      .select(
        "id, company_id, project_id, certificate_type, certificate_number, status, effective_date, pr_at_cod, payload, signatures, signed_pdf_path, created_at, updated_at",
      )
      .single();
    if (uErr) throw uErr;

    if (closed && type === "cod") {
      gate = await requestCodGate(context, companyId, (current as any).project_id);
    }

    await audit(
      context,
      closed ? "certificate.signed" : "certificate.signature_added",
      "commissioning_certificates",
      (current as any).id,
      {
        certificate_type: type,
        certificate_number: (current as any).certificate_number,
        effective_date: (current as any).effective_date,
        party: data.party,
        signer_name: nextSignature.name,
      },
    );

    return {
      row: {
        ...(updated as any),
        signatures: Array.isArray((updated as any).signatures)
          ? ((updated as any).signatures as CertSignature[])
          : nextSignatures,
        payload: (updated as any).payload ?? payload,
      },
      closed,
      missing,
      gate,
    };
  });

// ---------------------------------------------------------------------------
// attachSignedPdf — record the PDF path after client-side render+upload
// ---------------------------------------------------------------------------
export const attachSignedPdf = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attachPdfInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => WRITE_ROLES.has(r))) httpError(403, "forbidden");

    const { data: row } = await context.supabase
      .from("commissioning_certificates")
      .select("id, company_id, status")
      .eq("id", data.certificateId)
      .maybeSingle();
    if (!row || (row as any).company_id !== companyId)
      httpError(404, "certificate_not_found");
    if ((row as any).status !== "signed") httpError(409, "certificate_not_signed");

    const { error } = await context.supabase
      .from("commissioning_certificates")
      .update({ signed_pdf_path: data.filePath })
      .eq("id", data.certificateId);
    if (error) throw error;

    await audit(context, "certificate.pdf_attached", "commissioning_certificates", data.certificateId, {
      file_path: data.filePath,
    });
    return { ok: true };
  });

// Re-export types for consumers.
export type { CertParty, CertSignature, CertificateType, CertificateStatus };
export { CERT_TYPES };
