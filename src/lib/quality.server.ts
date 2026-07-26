// P-183 — Server-only helpers for the quality expansion. Kept out of
// *.functions.ts so the serverFn split transform can't drop siblings.
import type { Json } from "@/integrations/supabase/types";
import type { Client } from "@/lib/cwp.server";
import { audit, httpError } from "@/lib/cwp.server";
import {
  calibrationState,
  formatQaNumber,
  HOLD_POINT_MESSAGE,
  nextQaSequence,
  type DossierSection,
} from "@/lib/quality.rules";

export const QA_DOC_WRITER_ROLES = [
  "construction_admin",
  "engineering_admin",
  "company_admin",
] as const;

export const QA_TEST_WRITER_ROLES = [
  "construction_admin",
  "foreman",
  "field_technician",
  "company_admin",
] as const;

export type QaNumberedTable =
  | "inspection_test_plans"
  | "material_inspection_requests"
  | "factory_acceptance_tests"
  | "site_acceptance_tests"
  | "test_certificates"
  | "commissioning_dossiers";

export type QaNumberColumn =
  | "itp_number"
  | "mir_number"
  | "fat_number"
  | "sat_number"
  | "cert_number"
  | "dossier_number";

const UNIQUE_VIOLATION = "23505";

async function mintQaNumber(
  client: Client,
  table: QaNumberedTable,
  column: QaNumberColumn,
  prefix: string,
  companyId: string,
): Promise<string> {
  const { data, error } = await client
    .from(table)
    .select(column)
    .eq("company_id", companyId)
    .like(column, `${prefix}-%`)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw error;
  const existing = ((data ?? []) as unknown as Array<Record<string, string>>).map((r) => r[column]);
  return formatQaNumber(prefix, nextQaSequence(prefix, existing));
}

/** Insert a numbered QA row, retrying when a concurrent writer takes the number. */
export async function insertQaRow<T>(
  client: Client,
  table: QaNumberedTable,
  column: QaNumberColumn,
  prefix: string,
  companyId: string,
  buildRow: (num: string) => Record<string, unknown>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    const num = await mintQaNumber(client, table, column, prefix, companyId);
    const { data, error } = await client
      .from(table)
      .insert(buildRow(num) as never)
      .select("*")
      .single();
    if (!error) return data as T;
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    lastError = error;
  }
  throw lastError ?? new Error("number_allocation_failed");
}

/** Generic insert for the un-numbered discipline test-record tables. */
export async function insertTestRecord<T>(
  client: Client,
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client
    .from(table as never)
    .insert(row as never)
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      httpError(409, "duplicate_record", "A record already exists for this key.");
    throw error;
  }
  return data as T;
}

export type QaRow = Record<string, Json>;

export async function listQaRows<T extends QaRow = QaRow>(
  client: Client,
  table: string,
  companyScopedColumn: "project_id" | "company_id",
  value: string,
  orderColumn = "created_at",
): Promise<T[]> {
  const { data, error } = await client
    .from(table as never)
    .select("*")
    .eq(companyScopedColumn, value)
    .order(orderColumn, { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as T[];
}

/* --------------------------- hold-point gate ------------------------------ */

/**
 * Calls the server-side gate. Maps the P0001 exception raised by
 * assert_no_open_hold_point onto HTTP 409 with the operator message.
 */
export async function assertNoOpenHoldPoint(
  client: Client,
  cwpId: string | null | undefined,
): Promise<void> {
  if (!cwpId) return;
  const { error } = await client.rpc("assert_no_open_hold_point" as never, {
    p_cwp_id: cwpId,
  } as never);
  if (!error) return;
  const message = (error as { message?: string }).message ?? "";
  if (message.includes("open_hold_point")) httpError(409, "open_hold_point", HOLD_POINT_MESSAGE);
  throw error;
}

/* ---------------------------- calibration --------------------------------- */

export type CalibrationRow = {
  instrument_tag: string;
  instrument: string;
  cal_date: string;
  next_due: string | null;
};

/** Most recent calibration for a tool tag within the company. */
export async function latestCalibration(
  client: Client,
  companyId: string,
  toolTag: string,
): Promise<CalibrationRow | null> {
  const { data, error } = await client
    .from("calibration_records")
    .select("instrument_tag,instrument,cal_date,next_due")
    .eq("company_id", companyId)
    .eq("instrument_tag", toolTag)
    .order("cal_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as CalibrationRow | undefined) ?? null;
}

/**
 * Torque tools must trace to a calibration record that was still valid on the
 * torque date. Out-of-calibration or untraceable tools are rejected (422).
 */
export async function assertToolCalibrated(
  client: Client,
  companyId: string,
  toolTag: string | null | undefined,
  torqueDate: string,
): Promise<void> {
  if (!toolTag) return;
  const row = await latestCalibration(client, companyId, toolTag);
  if (!row)
    httpError(422, "tool_not_calibrated", `No calibration record found for tool ${toolTag}.`);
  const state = calibrationState(row!.next_due, torqueDate);
  if (state === "expired" || state === "unknown")
    httpError(
      422,
      "tool_out_of_calibration",
      `Tool ${toolTag} was out of calibration on ${torqueDate}.`,
    );
}

/* ------------------------------ dossiers ---------------------------------- */

const DOSSIER_TABLES: Record<string, string> = {
  itp: "inspection_test_plans",
  mir: "material_inspection_requests",
  fat: "factory_acceptance_tests",
  sat: "site_acceptance_tests",
  certificate: "test_certificates",
  calibration: "calibration_records",
  welding: "welding_records",
  torque: "torque_records",
  cable: "cable_test_results",
  thermographic: "thermographic_inspections",
  relay: "relay_testing",
  transformer: "transformer_test_results",
};

/** Every section id must resolve to a live row the caller can read. */
export async function assertDossierSectionsResolve(
  client: Client,
  sections: readonly DossierSection[],
): Promise<void> {
  for (const section of sections) {
    const table = DOSSIER_TABLES[section.entity_type];
    if (!table) httpError(422, "unknown_entity_type", `Unknown section type ${section.entity_type}`);
    const ids = section.entity_ids ?? [];
    if (ids.length === 0) continue;
    const { data, error } = await client
      .from(table as never)
      .select("id")
      .in("id", ids as never);
    if (error) throw error;
    if ((data ?? []).length !== ids.length)
      httpError(422, "dangling_section_reference", `Section ${section.key} references missing rows`);
  }
}

export async function auditQa(
  client: Client,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await audit(client, action, entity, entityId, metadata);
}
