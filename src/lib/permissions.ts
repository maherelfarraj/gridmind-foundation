/**
 * Stub permissions layer for GridMind EPC.
 *
 * Batch 03 replaces this with a real session context sourced from the
 * `user_roles` table and the active company's plan tier. Keep the exported
 * names stable: `ModuleKey`, `Role`, `PlanTier`, `ROLE_TO_MODULES`,
 * `MODULE_PLAN_REQUIREMENTS`, `getVisibleModules`, `DEV_SESSION_CONTEXT`.
 */

export type Role =
  | "viewer"
  | "member"
  | "manager"
  | "company_admin"
  | "super_admin";

export type PlanTier = "starter" | "growth" | "enterprise";

// Canonical module keys live in ./modules. `admin` is a UI-only key used for
// navigation sections that don't map to a module_access_rules row.
import { MODULE_KEYS as CANONICAL_MODULE_KEYS, planAllowsModule } from "./modules";
export type { ModuleKey as CanonicalModuleKey } from "./modules";

export type ModuleKey = (typeof CANONICAL_MODULE_KEYS)[number] | "admin";

const CORE_MODULES: ModuleKey[] = [...CANONICAL_MODULE_KEYS];

export const ROLE_TO_MODULES: Record<Role, ModuleKey[]> = {
  viewer: [
    "crm",
    "engineering",
    "planning_budget",
    "field_qaqc",
    "commissioning",
    "om_scada",
    "portals",
  ],
  member: [...CORE_MODULES],
  manager: [...CORE_MODULES],
  company_admin: [...CORE_MODULES, "admin"],
  super_admin: [...CORE_MODULES, "admin"],
};

/**
 * Modules the given role + plan tier may see in navigation. Consumers should
 * treat this as authoritative for hiding nav items ONLY as a fallback — the
 * server-side `module_access_rules` table (via `listModuleAccess`) is the
 * runtime source of truth used by the sidebar.
 */
export function getVisibleModules(role: Role, planTier: PlanTier): Set<ModuleKey> {
  const allowedByRole = ROLE_TO_MODULES[role] ?? [];
  const visible = allowedByRole.filter((moduleKey) => {
    if (moduleKey === "admin") return true;
    return planAllowsModule(planTier, moduleKey);
  });
  return new Set(visible);
}


export interface SessionContext {
  role: Role;
  planTier: PlanTier;
}

/**
 * Development default used by the AppShell until Batch 03 wires a real
 * session context. Set to the most-privileged combination so every nav
 * item is visible while the module surfaces are being built out.
 */
export const DEV_SESSION_CONTEXT: SessionContext = {
  role: "company_admin",
  planTier: "enterprise",
};

// ---------------------------------------------------------------------------
// Departments — single source of truth for the 9 fixed company departments.
// Department admin membership is stored as a row in `user_roles` with the
// corresponding `<key>_admin` app_role; no separate departments table exists.
// ---------------------------------------------------------------------------

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  HardHat,
  Receipt,
  Ruler,
  Scale,
  ShieldAlert,
  ShoppingCart,
  Wallet,
  Wrench,
} from "lucide-react";
import type { GrantableRole } from "./role-groups";

export type DepartmentKey =
  | "engineering"
  | "procurement"
  | "construction"
  | "hse"
  | "finance"
  | "legal"
  | "om"
  | "scada"
  | "billing";

export interface Department {
  key: DepartmentKey;
  name: string;
  adminRole: GrantableRole;
  responsibilities: string;
  icon: LucideIcon;
}

export const DEPARTMENTS: readonly Department[] = [
  {
    key: "engineering",
    name: "Engineering",
    adminRole: "engineering_admin",
    responsibilities:
      "Designs, drawings register, calculations, BOM, IFC releases.",
    icon: Ruler,
  },
  {
    key: "procurement",
    name: "Procurement",
    adminRole: "procurement_admin",
    responsibilities:
      "Vendors, RFQs, purchase orders, receipts, three-way match.",
    icon: ShoppingCart,
  },
  {
    key: "construction",
    name: "Construction",
    adminRole: "construction_admin",
    responsibilities:
      "Daily reports, manpower, discipline progress, mobilization.",
    icon: HardHat,
  },
  {
    key: "hse",
    name: "HSE",
    adminRole: "hse_admin",
    responsibilities:
      "Incidents, near-misses, inspections, training records (24h incident logging).",
    icon: ShieldAlert,
  },
  {
    key: "finance",
    name: "Finance",
    adminRole: "finance_admin",
    responsibilities:
      "Budgets, EVM, cash flow, invoices, change orders.",
    icon: Wallet,
  },
  {
    key: "legal",
    name: "Legal",
    adminRole: "legal_admin",
    responsibilities:
      "Contracts, obligations, claims, lender DD items.",
    icon: Scale,
  },
  {
    key: "om",
    name: "O&M",
    adminRole: "om_admin",
    responsibilities:
      "Work orders, preventive maintenance, warranties, service tickets, O&M reports.",
    icon: Wrench,
  },
  {
    key: "scada",
    name: "SCADA",
    adminRole: "scada_admin",
    responsibilities:
      "Connectors, telemetry, alarms, plant KPIs.",
    icon: Activity,
  },
  {
    key: "billing",
    name: "Billing",
    adminRole: "billing_admin",
    responsibilities:
      "Pay applications, milestone billing, debit notes.",
    icon: Receipt,
  },
] as const;

// Compile-time exhaustiveness: adding a DepartmentKey requires adding an entry above.
type _DepartmentExhaustive = Exclude<
  DepartmentKey,
  (typeof DEPARTMENTS)[number]["key"]
>;
const _departmentExhaustive: _DepartmentExhaustive[] = [];
void _departmentExhaustive;
