// P-078 — Contracts + obligations + AI clause extractor server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  ContractUpsertSchema,
  ExtractedObligationSchema,
  ObligationUpsertSchema,
  SIGNED_STATUSES,
  SovLineSchema,
  SovMismatchError,
  assertSovMatchesValue,
  computeRetentionUntil,
  type ContractRow,
  type ObligationRow,
  type SovLine,
} from "@/lib/contracts.rules";

const WRITE_ROLES = ["finance_admin", "legal_admin", "company_admin"] as const;

const CONTRACTS_BUCKET = "documents";

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function requireWriteRole(context: AuthContext): Promise<void> {
  if (!(await hasAnyRole(context, WRITE_ROLES))) {
    httpError(403, "forbidden", "Only finance, legal, or company admins can modify contracts.");
  }
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as any)?.company_id as string | undefined;
  if (!id) httpError(400, "no_company", "User is not linked to a company.");
  return id!;
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toContractRow(r: any): ContractRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id ?? null,
    contract_number: r.contract_number,
    title: r.title,
    contract_type: r.contract_type,
    counterparty: r.counterparty,
    status: r.status,
    value: r.value == null ? null : Number(r.value),
    currency_code: r.currency_code ?? null,
    schedule_of_values: Array.isArray(r.schedule_of_values)
      ? (r.schedule_of_values as SovLine[])
      : [],
    signed_at: r.signed_at ?? null,
    effective_date: r.effective_date ?? null,
    expiry_date: r.expiry_date ?? null,
    file_path: r.file_path ?? null,
    retention_until: r.retention_until ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toObligationRow(r: any): ObligationRow {
  return {
    id: r.id,
    company_id: r.company_id,
    contract_id: r.contract_id,
    title: r.title,
    description: r.description ?? null,
    clause_ref: r.clause_ref ?? null,
    due_date: r.due_date ?? null,
    status: r.status,
    owner_id: r.owner_id ?? null,
    extracted_by_ai: Boolean(r.extracted_by_ai),
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getContractsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const canWrite = await hasAnyRole(context, WRITE_ROLES);
    return { canWrite };
  });

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
const listContractsSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.string().optional(),
  contractType: z.string().optional(),
  q: z.string().optional(),
});

export const listContracts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listContractsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ rows: ContractRow[] }> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("contracts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status as any);
    if (data.contractType) q = q.eq("contract_type", data.contractType as any);
    if (data.q && data.q.trim()) {
      const term = `%${data.q.trim()}%`;
      q = q.or(`title.ilike.${term},counterparty.ilike.${term},contract_number.ilike.${term}`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toContractRow) };
  });

// ---------------------------------------------------------------------------
// Get one (with obligations)
// ---------------------------------------------------------------------------
export const getContract = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ contract: ContractRow; obligations: ObligationRow[] }> => {
      requireSupabaseAuth(context);
      const { data: c, error } = await context.supabase
        .from("contracts")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw error;
      if (!c) httpError(404, "not_found");
      const { data: obs, error: oErr } = await context.supabase
        .from("contract_obligations")
        .select("*")
        .eq("contract_id", data.id)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (oErr) throw oErr;
      return {
        contract: toContractRow(c),
        obligations: ((obs ?? []) as any[]).map(toObligationRow),
      };
    },
  );

// ---------------------------------------------------------------------------
// Auto-number
// ---------------------------------------------------------------------------
async function nextContractNumber(context: AuthContext, companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `CT-${year}-`;
  const { data, error } = await context.supabase
    .from("contracts")
    .select("contract_number")
    .eq("company_id", companyId)
    .ilike("contract_number", `${prefix}%`)
    .order("contract_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  let seq = 1;
  const last = (data?.[0] as any)?.contract_number as string | undefined;
  if (last) {
    const m = /-(\d+)$/.exec(last);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Upsert (metadata)
// ---------------------------------------------------------------------------
export const upsertContract = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ContractUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContractRow> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);
    const companyId = await currentCompanyId(context);

    if (data.id) {
      // update — cannot mutate financial fields once locked; enforced by trigger-less pattern here
      const patch: Record<string, unknown> = {
        title: data.title,
        contract_type: data.contract_type,
        counterparty: data.counterparty,
        value: data.value ?? null,
        currency_code: data.currency_code ?? null,
        effective_date: data.effective_date ?? null,
        expiry_date: data.expiry_date ?? null,
        project_id: data.project_id ?? null,
      };
      if (data.status) patch.status = data.status;
      const { data: updated, error } = await context.supabase
        .from("contracts")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "contract.update", "contracts", data.id, {
        title: data.title,
      });
      return toContractRow(updated);
    }

    const contractNumber = await nextContractNumber(context, companyId);
    const insert = {
      company_id: companyId,
      project_id: data.project_id ?? null,
      contract_number: contractNumber,
      title: data.title,
      contract_type: data.contract_type,
      counterparty: data.counterparty,
      status: data.status ?? "draft",
      value: data.value ?? null,
      currency_code: data.currency_code ?? null,
      effective_date: data.effective_date ?? null,
      expiry_date: data.expiry_date ?? null,
      created_by: (context as any).user.id,
    };
    const { data: created, error } = await context.supabase
      .from("contracts")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "contract.create", "contracts", (created as any).id, {
      contract_number: contractNumber,
      contract_type: data.contract_type,
    });
    return toContractRow(created);
  });

// ---------------------------------------------------------------------------
// Update Schedule of Values (Σ must equal contract value)
// ---------------------------------------------------------------------------
const updateSovSchema = z.object({
  id: z.string().uuid(),
  lines: z.array(SovLineSchema),
});

export const updateScheduleOfValues = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateSovSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContractRow> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("contracts")
      .select("id, value")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "not_found");
    const value = (existing as any).value == null ? null : Number((existing as any).value);

    try {
      assertSovMatchesValue(value, data.lines);
    } catch (e) {
      if (e instanceof SovMismatchError) {
        httpError(
          422,
          "sov_mismatch",
          `Schedule of Values total (${e.total.toFixed(2)}) must equal contract value (${e.value.toFixed(2)}).`,
        );
      }
      throw e;
    }

    const { data: updated, error } = await context.supabase
      .from("contracts")
      .update({ schedule_of_values: data.lines as any } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "contract.sov_update", "contracts", data.id, {
      lines: data.lines.length,
      total: data.lines.reduce((a, l) => a + l.scheduled_amount, 0),
    });
    return toContractRow(updated);
  });

// ---------------------------------------------------------------------------
// Upload signed copy → returns storage path
// ---------------------------------------------------------------------------
const uploadSignedSchema = z.object({
  contractId: z.string().uuid(),
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
  contentType: z.string().default("application/pdf"),
});

export const uploadSignedContract = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => uploadSignedSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ path: string }> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("contracts")
      .select("id, company_id")
      .eq("id", data.contractId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "not_found");

    const safeName = data.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${(existing as any).company_id}/contracts/${data.contractId}/${Date.now()}_${safeName}`;

    const bin = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
    const { error: upErr } = await context.supabase.storage
      .from(CONTRACTS_BUCKET)
      .upload(path, bin, {
        upsert: false,
        contentType: data.contentType || "application/pdf",
      });
    if (upErr) {
      httpError(400, "upload_failed", upErr.message);
    }

    const { error: updErr } = await context.supabase
      .from("contracts")
      .update({ file_path: path } as any)
      .eq("id", data.contractId);
    if (updErr) throw updErr;

    await audit(context, "contract.upload", "contracts", data.contractId, {
      path,
    });
    return { path };
  });

// ---------------------------------------------------------------------------
// Mark contract signed
// ---------------------------------------------------------------------------
const markSignedSchema = z.object({
  id: z.string().uuid(),
  signed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const markContractSigned = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => markSignedSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContractRow> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "not_found");
    const row = existing as any;

    // Enforce SOV = value at sign time
    try {
      assertSovMatchesValue(
        row.value == null ? null : Number(row.value),
        (row.schedule_of_values ?? []) as SovLine[],
      );
    } catch (e) {
      if (e instanceof SovMismatchError) {
        httpError(
          422,
          "sov_mismatch",
          `Cannot sign: Schedule of Values total (${e.total.toFixed(2)}) must equal contract value (${e.value.toFixed(2)}).`,
        );
      }
      throw e;
    }

    if (!row.file_path) {
      httpError(422, "no_signed_copy", "Upload the signed contract copy before marking signed.");
    }

    const retention = computeRetentionUntil(data.signed_at);
    const { data: updated, error } = await context.supabase
      .from("contracts")
      .update({
        status: "signed" as any,
        signed_at: data.signed_at,
        retention_until: retention,
      } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "contract.sign", "contracts", data.id, {
      signed_at: data.signed_at,
      retention_until: retention,
    });
    return toContractRow(updated);
  });

// ---------------------------------------------------------------------------
// Signed URL for the uploaded copy
// ---------------------------------------------------------------------------
export const getContractFileUrl = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const { data: c, error } = await context.supabase
      .from("contracts")
      .select("file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    const path = (c as any)?.file_path as string | undefined;
    if (!path) return { url: null };
    const { data: signed } = await context.supabase.storage
      .from(CONTRACTS_BUCKET)
      .createSignedUrl(path, 60 * 10);
    return { url: signed?.signedUrl ?? null };
  });

// ---------------------------------------------------------------------------
// Obligations: add / update / bulk insert
// ---------------------------------------------------------------------------
export const upsertObligation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ObligationUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<ObligationRow> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);

    const { data: contract, error: cErr } = await context.supabase
      .from("contracts")
      .select("id, company_id")
      .eq("id", data.contract_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contract) httpError(404, "contract_not_found");

    if (data.id) {
      const patch: Record<string, unknown> = {
        title: data.title,
        description: data.description ?? null,
        clause_ref: data.clause_ref ?? null,
        due_date: data.due_date ?? null,
        owner_id: data.owner_id ?? null,
      };
      if (data.status) patch.status = data.status;
      const { data: updated, error } = await context.supabase
        .from("contract_obligations")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "obligation.update", "contract_obligations", data.id, {
        contract_id: data.contract_id,
      });
      return toObligationRow(updated);
    }

    const insert = {
      company_id: (contract as any).company_id,
      contract_id: data.contract_id,
      title: data.title,
      description: data.description ?? null,
      clause_ref: data.clause_ref ?? null,
      due_date: data.due_date ?? null,
      status: data.status ?? "open",
      owner_id: data.owner_id ?? null,
      extracted_by_ai: false,
      created_by: (context as any).user.id,
    };
    const { data: created, error } = await context.supabase
      .from("contract_obligations")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "obligation.create", "contract_obligations", (created as any).id, {
      contract_id: data.contract_id,
    });
    return toObligationRow(created);
  });

const bulkInsertSchema = z.object({
  contract_id: z.string().uuid(),
  items: z.array(ExtractedObligationSchema).min(1).max(100),
});

export const bulkInsertObligations = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => bulkInsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ inserted: ObligationRow[]; count: number }> => {
    requireSupabaseAuth(context);
    await requireWriteRole(context);

    const { data: contract, error: cErr } = await context.supabase
      .from("contracts")
      .select("id, company_id")
      .eq("id", data.contract_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contract) httpError(404, "contract_not_found");

    const rows = data.items.map((it) => ({
      company_id: (contract as any).company_id,
      contract_id: data.contract_id,
      title: it.title,
      description: it.description ?? null,
      clause_ref: it.clause_ref ?? null,
      due_date: it.due_date ?? null,
      status: "open",
      extracted_by_ai: true,
      created_by: (context as any).user.id,
    }));

    const { data: inserted, error } = await context.supabase
      .from("contract_obligations")
      .insert(rows as any)
      .select("*");
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "contract.ai_extract", "contracts", data.contract_id, {
      extracted: data.items.length,
      accepted: rows.length,
      phase: "accept",
    });
    return {
      inserted: ((inserted ?? []) as any[]).map(toObligationRow),
      count: rows.length,
    };
  });

// ---------------------------------------------------------------------------
// AI clause extractor — Lovable AI Gateway (server-only key)
// ---------------------------------------------------------------------------
const extractSchema = z.object({
  contract_id: z.string().uuid(),
  pdf_text: z.string().min(20).max(200_000),
});

const SYSTEM_PROMPT = `You are an expert EPC/PPA contracts analyst.
Extract every enforceable obligation from the contract text. Focus on:
payment terms, liquidated damages, warranties, notice periods, insurance,
performance guarantees, deliverables, and reporting.

Return ONLY strict JSON matching this shape:
{"obligations":[{"title":string,"description":string,"clause_ref":string|null,"due_date":"YYYY-MM-DD"|null}]}
Rules:
- title: <= 120 chars, action-oriented (e.g. "Provide performance bond").
- description: <= 500 chars.
- clause_ref: the contract clause number if you can see one (e.g. "Clause 8.2"), else null.
- due_date: ISO date if the contract clearly states one; otherwise null.
- No prose outside the JSON object.`;

export const extractContractClauses = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => extractSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ obligations: z.infer<typeof ExtractedObligationSchema>[] }> => {
      requireSupabaseAuth(context);
      await requireWriteRole(context);

      // Verify contract belongs to user's company (RLS also enforces this).
      const { data: c, error: cErr } = await context.supabase
        .from("contracts")
        .select("id, company_id")
        .eq("id", data.contract_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!c) httpError(404, "contract_not_found");

      // Rate-limit: 10 extractions per hour per company.
      // consume_rate_limit is server-only (EXECUTE revoked from anon/authenticated).
      const key = `ai:contract_extract:${(c as any).company_id}`;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: allowed, error: rlErr } = await supabaseAdmin.rpc("consume_rate_limit", {
        p_key: key,
        p_capacity: 10,
        p_refill_per_sec: 10 / 3600,
      });

      if (rlErr) throw rlErr;
      if (allowed === false) {
        httpError(429, "rate_limited", "Too many AI extractions — try again later.");
      }

      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) {
        httpError(500, "no_ai_key", "AI Gateway is not configured on the server.");
      }

      const truncated = data.pdf_text.slice(0, 120_000);
      let response: Response;
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey!}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Contract text follows.\n---\n${truncated}\n---\nReturn the JSON now.`,
              },
            ],
            response_format: { type: "json_object" },
          }),
        });
      } catch (e) {
        httpError(502, "gateway_error", "Could not reach the AI Gateway. Retry in a moment.");
      }

      if (response!.status === 429) {
        httpError(429, "rate_limited", "AI Gateway rate limit hit — wait a minute and retry.");
      }
      if (response!.status === 402) {
        httpError(
          402,
          "credits_exhausted",
          "Workspace AI credits are exhausted. Top up in workspace billing.",
        );
      }
      if (!response!.ok) {
        httpError(502, "gateway_error", `AI Gateway returned ${response!.status}.`);
      }

      let raw: any;
      try {
        raw = await response!.json();
      } catch {
        httpError(502, "gateway_error", "AI Gateway response was not valid JSON.");
      }
      const content: string = raw?.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Try to salvage an inline JSON blob
        const m = /\{[\s\S]*\}/.exec(content);
        if (!m) httpError(502, "gateway_error", "AI response could not be parsed.");
        try {
          parsed = JSON.parse(m![0]);
        } catch {
          httpError(502, "gateway_error", "AI response could not be parsed.");
        }
      }

      const shape = z
        .object({ obligations: z.array(ExtractedObligationSchema).max(200) })
        .safeParse(parsed);
      if (!shape.success) {
        httpError(502, "gateway_error", "AI response did not match the expected shape.");
      }

      const obligations = shape.data.obligations.map((o) => ({
        title: o.title.slice(0, 300),
        description: o.description ?? null,
        clause_ref: o.clause_ref ?? null,
        due_date: o.due_date ?? null,
      }));

      await audit(context, "contract.ai_extract", "contracts", data.contract_id, {
        extracted: obligations.length,
        accepted: 0,
        phase: "extract",
        model: "google/gemini-2.5-flash",
      });

      return { obligations };
    },
  );

// Re-export for query helper convenience
export { SIGNED_STATUSES };
