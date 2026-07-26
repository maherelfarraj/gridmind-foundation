// P-154 — Server-only helpers for PV stringing (kept out of the serverfn-split
// module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { httpError } from "@/lib/pv-layout.server";
import type { StringingResult } from "@/lib/pv/stringing";

/** Layout statuses whose electrical design may still be regenerated. */
export const REGENERABLE_LAYOUT_STATUSES = ["draft", "under_review"];

export interface LayoutContextRow {
  id: string;
  company_id: string;
  project_id: string;
  status: string;
}

/** Loads the layout and rejects regeneration on approved/superseded layouts. */
export async function requireRegenerableLayout(
  context: AuthContext,
  layoutId: string,
): Promise<LayoutContextRow> {
  const { data, error } = await context.supabase
    .from("pv_layouts")
    .select("id, company_id, project_id, status")
    .eq("id", layoutId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Layout not found.");
  const row = data as unknown as LayoutContextRow;
  if (!REGENERABLE_LAYOUT_STATUSES.includes(row.status)) {
    httpError(
      409,
      "layout_locked",
      "Approved layouts are immutable — regenerate the electrical design on a draft revision.",
    );
  }
  return row;
}

export function stringRowsFrom(
  result: StringingResult,
  ctx: { companyId: string; layoutId: string; moduleId: string | null; userId: string | null },
) {
  return result.strings.map((s) => ({
    company_id: ctx.companyId,
    layout_id: ctx.layoutId,
    block_id: s.blockId,
    string_label: s.label,
    module_id: ctx.moduleId,
    modules_in_series: s.modulesInSeries,
    voc_at_min_temp_v: s.vocAtMinTempV,
    vmp_at_max_temp_v: s.vmpAtMaxTempV,
    dc_power_kwp: s.dcPowerKwp,
    combiner_label: s.combinerLabel,
    inverter_station_label: s.inverterStationLabel,
    mppt_index: s.mpptIndex,
    cable: {
      cable_id: s.cable.cableId,
      cross_section_mm2: s.cable.crossSectionMm2,
      length_m: s.cable.lengthM,
      voltage_drop_pct: s.cable.voltageDropPct,
      loss_pct: s.cable.lossPct,
      routing_factor: s.cable.routingFactor,
    },
    valid: s.valid,
    warnings: s.warnings,
    created_by: ctx.userId,
  }));
}

export function assignmentRowsFrom(
  result: StringingResult,
  stringIdByLabel: Map<string, string>,
  ctx: { companyId: string; layoutId: string; inverterId: string | null; userId: string | null },
) {
  return result.allocations.map((a) => {
    const feeder = result.feeders.find((f) => f.stationLabels.includes(a.inverterStationLabel));
    return {
      company_id: ctx.companyId,
      layout_id: ctx.layoutId,
      inverter_station_label: a.inverterStationLabel,
      inverter_id: ctx.inverterId,
      mppt_index: a.mpptIndex,
      string_ids: a.stringLabels
        .map((l) => stringIdByLabel.get(l))
        .filter((id): id is string => Boolean(id)),
      dc_kwp_on_mppt: a.dcKwpOnMppt,
      inverter_ac_kw: a.inverterAcKw,
      inverter_dc_kwp: a.inverterDcKwp,
      dc_ac_ratio: a.dcAcRatio,
      loading_pct: a.loadingPct,
      combiner_assignment: a.combinerAssignment,
      mv_feeder: feeder
        ? {
            label: feeder.label,
            cable_id: feeder.cableId,
            length_m: feeder.lengthM,
            voltage_kv: feeder.voltageKv,
            loading_pct: feeder.loadingPct,
          }
        : {},
      transformer: feeder
        ? {
            transformer_id: feeder.transformerId,
            station_label: feeder.transformerStationLabel,
            loading_pct: feeder.transformerLoadingPct,
          }
        : {},
      equipment_counts: result.counts,
      warnings: a.warnings,
      created_by: ctx.userId,
    };
  });
}
