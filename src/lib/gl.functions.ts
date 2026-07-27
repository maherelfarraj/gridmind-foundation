// P-208 — GL export server functions. Thin wrapper module: imports +
// createServerFn declarations only (tss-serverfn-split safe).
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { audit, httpError } from "@/lib/payments.server";
import { toCsv } from "@/lib/csv";
import {
  GL_CSV_HEADERS,
  GenerateGlExportSchema,
  RunIdSchema,
  UpdateGlMappingSchema,
  buildJournal,
  defaultPeriod,
  glCsvRows,
  glExportPath,
  type GlGenerationResult,
  type GlLine,
  type GlMapping,
} from "@/lib/gl.rules";
import {
  assertGlWrite,
  canWriteGl,
  gatherSourceEvents,
  glCompanyId,
  insertLines,
  insertRun,
  loadMappings,
  loadRunLines,
  loadRuns,
  resolveCompanyBaseCurrency,
  supersedePriorRuns,
  todayIso,
  uploadCsv,
  type GlRunRow,
} from "@/lib/gl.server";

export interface GlWorkspace {
  can_write: boolean;
  base_currency: string;
  default_period: { from: string; to: string };
  mappings: GlMapping[];
  runs: GlRunRow[];
}

export const getGlWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<GlWorkspace> => {
    requireSupabaseAuth(context);
    const [mappings, runs, base, canWrite] = await Promise.all([
      loadMappings(context),
      loadRuns(context),
      resolveCompanyBaseCurrency(context),
      canWriteGl(context),
    ]);
    return {
      can_write: canWrite,
      base_currency: base,
      default_period: defaultPeriod(todayIso()),
      mappings,
      runs,
    };
  });

export interface GlPreview extends GlGenerationResult {
  base_currency: string;
  period_from: string;
  period_to: string;
  fx_missing: string[];
}

export const previewGlExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GenerateGlExportSchema.parse(input))
  .handler(async ({ data, context }): Promise<GlPreview> => {
    requireSupabaseAuth(context);
    await assertGlWrite(context);
    const base = await resolveCompanyBaseCurrency(context);
    const [mappings, sources] = await Promise.all([
      loadMappings(context),
      gatherSourceEvents(context, data.period_from, data.period_to, base),
    ]);
    const result = buildJournal(sources.events, mappings, base);
    return {
      ...result,
      base_currency: base,
      period_from: data.period_from,
      period_to: data.period_to,
      fx_missing: sources.fx_missing,
    };
  });

export interface GlGenerated {
  run_id: string;
  run_number: string;
  row_count: number;
  total_debit: number;
  total_credit: number;
  superseded: string[];
}

export const generateGlExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GenerateGlExportSchema.parse(input))
  .handler(async ({ data, context }): Promise<GlGenerated> => {
    requireSupabaseAuth(context);
    await assertGlWrite(context);
    const companyId = data.company_id ?? (await glCompanyId(context));
    // P-113 gate FIRST — typed 423 when an approval lock blocks exports.
    await assertExportAllowed(context.supabase, companyId, "gl_export");

    const base = await resolveCompanyBaseCurrency(context);
    const [mappings, sources] = await Promise.all([
      loadMappings(context),
      gatherSourceEvents(context, data.period_from, data.period_to, base),
    ]);
    const journal = buildJournal(sources.events, mappings, base);

    if (!journal.balanced) {
      httpError(409, "gl_unbalanced", "The journal does not balance — export refused.", {
        unbalanced: journal.unbalanced,
        missing_mappings: journal.missing_mappings,
        disabled_mappings: journal.disabled_mappings,
        total_debit: journal.total_debit,
        total_credit: journal.total_credit,
      });
    }
    if (journal.lines.length === 0) {
      httpError(422, "gl_empty", "No ledger-eligible activity in that range.");
    }

    const run = await insertRun(context, {
      company_id: companyId,
      period_from: data.period_from,
      period_to: data.period_to,
      status: "generated",
      base_currency_code: base,
      row_count: journal.lines.length,
      total_debit: journal.total_debit,
      total_credit: journal.total_credit,
      source_counts: journal.source_counts,
      generated_by: context.user!.id,
    });
    await insertLines(context, companyId, run.id, journal.lines);
    const superseded = await supersedePriorRuns(
      context,
      data.period_from,
      data.period_to,
      run.id,
    );

    await audit(context, "gl.export_generated", "gl_export_run", run.id, {
      run_number: run.run_number,
      period_from: data.period_from,
      period_to: data.period_to,
      row_count: journal.lines.length,
      total_debit: journal.total_debit,
      total_credit: journal.total_credit,
      superseded,
    });

    return {
      run_id: run.id,
      run_number: run.run_number,
      row_count: journal.lines.length,
      total_debit: journal.total_debit,
      total_credit: journal.total_credit,
      superseded,
    };
  });

export const getGlRun = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => RunIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ lines: GlLine[] }> => {
    requireSupabaseAuth(context);
    return { lines: await loadRunLines(context, data.run_id) };
  });

export const downloadGlExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => RunIdSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ run_number: string; file_path: string; csv: string }> => {
      requireSupabaseAuth(context);
      await assertGlWrite(context);
      const companyId = await glCompanyId(context);
      await assertExportAllowed(context.supabase, companyId, "gl_export");

      const { data: run, error } = await context.supabase
        .from("gl_export_runs")
        .select("id, run_number, status")
        .eq("id", data.run_id)
        .maybeSingle();
      if (error) throw error;
      if (!run) httpError(404, "run_not_found", "That GL run no longer exists.");
      const runRow = run as { id: string; run_number: string; status: string };

      const lines = await loadRunLines(context, data.run_id);
      const csv = toCsv([...GL_CSV_HEADERS], glCsvRows(lines));
      const path = glExportPath(companyId, runRow.run_number);
      await uploadCsv(context, path, csv);

      const patch: Record<string, unknown> =
        runRow.status === "superseded"
          ? { file_path: path }
          : { status: "downloaded", file_path: path, downloaded_at: new Date().toISOString() };
      await context.supabase
        .from("gl_export_runs")
        .update(patch as never)
        .eq("id", data.run_id);

      await audit(context, "gl.export_downloaded", "gl_export_run", data.run_id, {
        run_number: runRow.run_number,
        file_path: path,
        row_count: lines.length,
      });

      return { run_number: runRow.run_number, file_path: path, csv };
    },
  );

export const updateGlMapping = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => UpdateGlMappingSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertGlWrite(context);
    const companyId = await glCompanyId(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("gl_account_mappings")
      .select(
        "id, debit_account_code, debit_account_name, credit_account_code, credit_account_name, enabled",
      )
      .eq("event_type", data.event_type)
      .maybeSingle();
    if (exErr) throw exErr;

    const values = {
      company_id: companyId,
      event_type: data.event_type,
      debit_account_code: data.debit_account_code,
      debit_account_name: data.debit_account_name,
      credit_account_code: data.credit_account_code,
      credit_account_name: data.credit_account_name,
      enabled: data.enabled,
    };

    if (existing) {
      const { error } = await context.supabase
        .from("gl_account_mappings")
        .update(values as never)
        .eq("id", (existing as { id: string }).id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("gl_account_mappings")
        .insert(values as never);
      if (error) throw error;
    }

    await audit(context, "gl.mapping_updated", "gl_account_mapping", null, {
      event_type: data.event_type,
      before: existing ?? null,
      after: values,
    });
    return { ok: true };
  });
