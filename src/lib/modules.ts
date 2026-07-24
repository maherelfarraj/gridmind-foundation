// Canonical module registry — single source of truth for the 9 module keys
// in migration 0005's `module_access_rules_module_check` CONSTRAINT and the
// baseline plan tiers evaluated by the `has_module_access` SQL function.
// Do not add or rename keys without amending the CHECK constraint first.
import type { PlanTier } from "./permissions";

export const MODULE_KEYS = [
  "crm",
  "engineering",
  "procurement",
  "planning_budget",
  "field_qaqc",
  "commissioning",
  "portals",
  "om_scada",
  "green_hydrogen",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  /** Plan tiers that include this module in the has_module_access baseline. */
  baselinePlans: readonly PlanTier[];
  /** Green H₂ is enterprise-only and cannot be enabled by override otherwise. */
  enterpriseOnly: boolean;
}

const STARTER: readonly PlanTier[] = ["starter", "growth", "enterprise"];
const GROWTH: readonly PlanTier[] = ["growth", "enterprise"];
const ENTERPRISE: readonly PlanTier[] = ["enterprise"];

export const MODULE_REGISTRY: Record<ModuleKey, ModuleDefinition> = {
  crm: {
    key: "crm",
    label: "CRM & Origination",
    description: "Leads, opportunities, proposals, and win/loss tracking.",
    baselinePlans: STARTER,
    enterpriseOnly: false,
  },
  engineering: {
    key: "engineering",
    label: "Engineering",
    description: "Designs, drawings register, calculations, BOM, IFC releases.",
    baselinePlans: STARTER,
    enterpriseOnly: false,
  },
  procurement: {
    key: "procurement",
    label: "Procurement",
    description: "Vendors, RFQs, purchase orders, receipts, three-way match.",
    baselinePlans: STARTER,
    enterpriseOnly: false,
  },
  planning_budget: {
    key: "planning_budget",
    label: "Planning & Budget",
    description: "Schedules, budgets, EVM, cash flow, change orders.",
    baselinePlans: STARTER,
    enterpriseOnly: false,
  },
  field_qaqc: {
    key: "field_qaqc",
    label: "Field, HSE & QA/QC",
    description: "Daily reports, inspections, incidents, training records.",
    baselinePlans: GROWTH,
    enterpriseOnly: false,
  },
  commissioning: {
    key: "commissioning",
    label: "Commissioning",
    description: "Punch lists, energization, handover, closeout.",
    baselinePlans: GROWTH,
    enterpriseOnly: false,
  },
  portals: {
    key: "portals",
    label: "Client & Investor Portals",
    description: "External stakeholder access to project data.",
    baselinePlans: GROWTH,
    enterpriseOnly: false,
  },
  om_scada: {
    key: "om_scada",
    label: "O&M & SCADA",
    description: "Work orders, preventive maintenance, telemetry, alarms.",
    baselinePlans: ENTERPRISE,
    enterpriseOnly: false,
  },
  green_hydrogen: {
    key: "green_hydrogen",
    label: "Green H₂",
    description: "Electrolyser, storage, and H₂ plant modules (enterprise only).",
    baselinePlans: ENTERPRISE,
    enterpriseOnly: true,
  },
};

/** Mirrors the plan-tier baseline in `public.has_module_access`. */
export function planAllowsModule(plan: PlanTier, key: ModuleKey): boolean {
  const def = MODULE_REGISTRY[key];
  if (def.enterpriseOnly && plan !== "enterprise") return false;
  return def.baselinePlans.includes(plan);
}
