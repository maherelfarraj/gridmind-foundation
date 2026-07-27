// P-188 — Pure declaration of the digital-thread impact map (blueprint §8).
// No React / Supabase imports: safe for unit tests and both runtimes.

export const THREAD_EVENTS = [
  "module_changed",
  "inverter_changed",
  "redline_marked",
  "asbuilt_approved",
  "scada_alarm_raised",
] as const;

export type ThreadEvent = (typeof THREAD_EVENTS)[number];

/** Entity types accepted by the 0077 CHECK vocabulary that the engine emits. */
export type ThreadEntityType =
  | "project"
  | "layout"
  | "simulation"
  | "sld"
  | "bom"
  | "rfq"
  | "po"
  | "vendor"
  | "drawing"
  | "equipment"
  | "work_order"
  | "warranty_claim"
  | "spare_part"
  | "scada_alarm"
  | "cwp"
  | "document";

/** Resolver keys — the engine maps each to a guarded lookup. */
export type ResolverKey =
  | "latest_layout"
  | "latest_bom"
  | "latest_simulation"
  | "latest_rfq"
  | "latest_po"
  | "payload_vendor"
  | "project_self"
  | "latest_sld"
  | "payload_drawing"
  | "asbuilt_drawing"
  | "payload_equipment"
  | "alarm_equipment"
  | "alarm_drawing"
  | "alarm_warranty_claim"
  | "alarm_work_order"
  | "alarm_spare_part"
  | "alarm_vendor";

export interface ImpactSpec {
  /** Human-readable affected area shown in the thread UI. */
  area: string;
  entity_type: ThreadEntityType;
  /** What the owning module is being asked to do. Recommendation only. */
  action: string;
  resolver: ResolverKey;
  /** Link type used when a target id resolves. Defaults to "impacts". */
  link_type?: "impacts" | "derives";
  /** Role that owns the affected module — receives the notification. */
  owner_role: string;
}

export interface EventSpec {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  impacts: ImpactSpec[];
}

export const IMPACT_MAP: Record<ThreadEvent, EventSpec> = {
  module_changed: {
    title: "PV module changed",
    severity: "medium",
    impacts: [
      {
        area: "stringing",
        entity_type: "layout",
        action: "restring",
        resolver: "latest_layout",
        owner_role: "engineering_admin",
      },
      {
        area: "quantities",
        entity_type: "bom",
        action: "recalculate_quantities",
        resolver: "latest_bom",
        owner_role: "engineering_admin",
      },
      {
        area: "energy_yield",
        entity_type: "simulation",
        action: "rerun_simulation",
        resolver: "latest_simulation",
        owner_role: "engineering_admin",
      },
      {
        area: "procurement",
        entity_type: "rfq",
        action: "revise_rfq_lines",
        resolver: "latest_rfq",
        owner_role: "procurement_admin",
      },
      {
        area: "approved_vendor",
        entity_type: "vendor",
        action: "verify_approved_vendor",
        resolver: "payload_vendor",
        owner_role: "procurement_admin",
      },
    ],
  },
  inverter_changed: {
    title: "Inverter changed",
    severity: "high",
    impacts: [
      {
        area: "sld",
        entity_type: "sld",
        action: "update_single_line",
        resolver: "latest_sld",
        owner_role: "engineering_admin",
      },
      {
        area: "layout",
        entity_type: "layout",
        action: "revalidate_layout",
        resolver: "latest_layout",
        owner_role: "engineering_admin",
      },
      {
        area: "dc_ac_ratio",
        entity_type: "project",
        action: "review_dc_ac_ratio",
        resolver: "project_self",
        owner_role: "engineering_admin",
      },
      {
        area: "transformer_loading",
        entity_type: "sld",
        action: "recheck_transformer_loading",
        resolver: "latest_sld",
        owner_role: "engineering_admin",
      },
      {
        area: "cable_schedules",
        entity_type: "bom",
        action: "reissue_cable_schedule",
        resolver: "latest_bom",
        owner_role: "engineering_admin",
      },
      {
        area: "procurement_package",
        entity_type: "rfq",
        action: "revise_procurement_package",
        resolver: "latest_rfq",
        owner_role: "procurement_admin",
      },
      {
        area: "simulation",
        entity_type: "simulation",
        action: "rerun_simulation",
        resolver: "latest_simulation",
        owner_role: "engineering_admin",
      },
    ],
  },
  redline_marked: {
    title: "Red-line markup accepted",
    severity: "medium",
    impacts: [
      {
        area: "as_built",
        entity_type: "drawing",
        action: "issue_asbuilt_revision",
        resolver: "payload_drawing",
        link_type: "derives",
        owner_role: "construction_admin",
      },
    ],
  },
  asbuilt_approved: {
    title: "As-built drawing approved",
    severity: "medium",
    impacts: [
      {
        area: "equipment_registry",
        entity_type: "equipment",
        action: "sync_registry",
        resolver: "payload_equipment",
        owner_role: "om_admin",
      },
    ],
  },
  scada_alarm_raised: {
    title: "SCADA alarm raised",
    severity: "high",
    impacts: [
      {
        area: "equipment",
        entity_type: "equipment",
        action: "inspect_equipment",
        resolver: "alarm_equipment",
        owner_role: "om_admin",
      },
      {
        area: "drawing",
        entity_type: "drawing",
        action: "review_drawing",
        resolver: "alarm_drawing",
        owner_role: "engineering_admin",
      },
      {
        area: "warranty",
        entity_type: "warranty_claim",
        action: "evaluate_warranty_claim",
        resolver: "alarm_warranty_claim",
        owner_role: "om_admin",
      },
      {
        area: "work_order",
        entity_type: "work_order",
        action: "raise_or_update_work_order",
        resolver: "alarm_work_order",
        owner_role: "om_admin",
      },
      {
        area: "spare_parts",
        entity_type: "spare_part",
        action: "check_spare_availability",
        resolver: "alarm_spare_part",
        owner_role: "om_admin",
      },
      {
        area: "responsible_contractor",
        entity_type: "vendor",
        action: "notify_responsible_contractor",
        resolver: "alarm_vendor",
        owner_role: "om_admin",
      },
    ],
  },
};

/** Areas documented for an event — used by tests and the thread UI. */
export function impactAreas(event: ThreadEvent): string[] {
  return IMPACT_MAP[event].impacts.map((i) => i.area);
}

export function eventSeverity(event: ThreadEvent): EventSpec["severity"] {
  return IMPACT_MAP[event].severity;
}
