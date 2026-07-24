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

// ---------------------------------------------------------------------------
// P-028 — Permission simulator maps
// ROLE_MODULE_MAP: full per-role module visibility (all GrantableRole values).
// ROLE_ACTION_MATRIX: per-role, per-module allowed actions.
// These are UI-preview data only. Actual access is enforced by RLS and
// has_role() on every request; keep these consistent with server policies.
// ---------------------------------------------------------------------------

import { GRANTABLE_ROLES } from "./role-groups";
import { MODULE_KEYS as _MK } from "./modules";



export type Action = "view" | "create" | "edit" | "approve" | "export";
export const ACTIONS: readonly Action[] = ["view", "create", "edit", "approve", "export"] as const;

const CORE_VISIBLE: ModuleKey[] = [..._MK];
const ALL_ADMIN_VISIBLE: ModuleKey[] = [...CORE_VISIBLE, "admin"];

// Department admin → the module their department primarily lives in.
const DEPT_ADMIN_HOME: Record<string, ModuleKey> = {
  engineering_admin: "engineering",
  procurement_admin: "procurement",
  construction_admin: "field_qaqc",
  hse_admin: "field_qaqc",
  finance_admin: "planning_budget",
  legal_admin: "crm",
  om_admin: "om_scada",
  scada_admin: "om_scada",
};

// Operational role → modules they work in.
const OPERATIONAL_MODULES: Record<string, ModuleKey[]> = {
  engineer: ["engineering", "planning_budget", "field_qaqc"],
  sales: ["crm"],
  procurement_officer: ["procurement", "planning_budget"],
  foreman: ["field_qaqc", "commissioning"],
  field_technician: ["field_qaqc", "om_scada"],
};

// External viewer → read-only portals + limited context.
const EXTERNAL_MODULES: Record<string, ModuleKey[]> = {
  client_viewer: ["portals", "crm", "planning_budget"],
  investor_viewer: ["portals", "planning_budget"],
  lender_viewer: ["portals", "planning_budget"],
};

function buildRoleModuleMap(): Record<GrantableRole, ModuleKey[]> {
  const map = {} as Record<GrantableRole, ModuleKey[]>;
  for (const role of GRANTABLE_ROLES) {
    if (role === "company_admin" || role === "billing_admin" || role === "project_admin") {
      map[role] = [...ALL_ADMIN_VISIBLE];
    } else if (role in DEPT_ADMIN_HOME) {
      // Department admins see every core module (they coordinate cross-team)
      // but only get elevated actions in their own department module.
      map[role] = [...CORE_VISIBLE];
    } else if (role in OPERATIONAL_MODULES) {
      map[role] = [...OPERATIONAL_MODULES[role]];
    } else if (role in EXTERNAL_MODULES) {
      map[role] = [...EXTERNAL_MODULES[role]];
    } else {
      map[role] = [];
    }
  }
  return map;
}

export const ROLE_MODULE_MAP: Record<GrantableRole, ModuleKey[]> = buildRoleModuleMap();

const FULL_ACTIONS: readonly Action[] = ["view", "create", "edit", "approve", "export"];
const WRITE_ACTIONS: readonly Action[] = ["view", "create", "edit", "export"];
const VIEW_ONLY: readonly Action[] = ["view"];

function buildActionMatrix(): Record<GrantableRole, Partial<Record<ModuleKey, readonly Action[]>>> {
  const matrix = {} as Record<GrantableRole, Partial<Record<ModuleKey, readonly Action[]>>>;
  for (const role of GRANTABLE_ROLES) {
    const visible = ROLE_MODULE_MAP[role];
    const entry: Partial<Record<ModuleKey, readonly Action[]>> = {};

    if (role === "company_admin" || role === "billing_admin" || role === "project_admin") {
      for (const m of visible) entry[m] = FULL_ACTIONS;
    } else if (role in DEPT_ADMIN_HOME) {
      const home = DEPT_ADMIN_HOME[role];
      for (const m of visible) {
        if (m === "admin") continue;
        entry[m] = m === home ? FULL_ACTIONS : VIEW_ONLY;
      }
    } else if (role in OPERATIONAL_MODULES) {
      for (const m of visible) entry[m] = WRITE_ACTIONS;
    } else if (role in EXTERNAL_MODULES) {
      for (const m of visible) entry[m] = VIEW_ONLY;
    }

    matrix[role] = entry;
  }
  return matrix;
}

export const ROLE_ACTION_MATRIX: Record<
  GrantableRole,
  Partial<Record<ModuleKey, readonly Action[]>>
> = buildActionMatrix();

export function getActionsFor(role: GrantableRole, moduleKey: ModuleKey): readonly Action[] {
  return ROLE_ACTION_MATRIX[role]?.[moduleKey] ?? [];
}

// Compile-time exhaustiveness: any new GrantableRole must appear in the map.
type _RoleModuleExhaustive = Exclude<GrantableRole, keyof typeof ROLE_MODULE_MAP>;
const _roleModuleExhaustive: _RoleModuleExhaustive[] = [];
void _roleModuleExhaustive;

