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

export type ModuleKey =
  | "crm"
  | "engineering"
  | "procurement"
  | "planning"
  | "field"
  | "commissioning"
  | "om"
  | "partners"
  | "green_hydrogen"
  | "admin";

const CORE_MODULES: ModuleKey[] = [
  "crm",
  "engineering",
  "procurement",
  "planning",
  "field",
  "commissioning",
  "om",
  "partners",
  "green_hydrogen",
];

export const ROLE_TO_MODULES: Record<Role, ModuleKey[]> = {
  viewer: ["crm", "engineering", "planning", "field", "commissioning", "om", "partners"],
  member: [...CORE_MODULES],
  manager: [...CORE_MODULES],
  company_admin: [...CORE_MODULES, "admin"],
  super_admin: [...CORE_MODULES, "admin"],
};

export const MODULE_PLAN_REQUIREMENTS: Partial<Record<ModuleKey, PlanTier>> = {
  green_hydrogen: "enterprise",
};

const PLAN_RANK: Record<PlanTier, number> = {
  starter: 0,
  growth: 1,
  enterprise: 2,
};

function planMeets(actual: PlanTier, required: PlanTier): boolean {
  return PLAN_RANK[actual] >= PLAN_RANK[required];
}

/**
 * Modules the given role + plan tier may see in navigation. Consumers should
 * treat this as authoritative for hiding nav items (not for authorization —
 * server-side RLS remains the source of truth for data access).
 */
export function getVisibleModules(role: Role, planTier: PlanTier): Set<ModuleKey> {
  const allowedByRole = ROLE_TO_MODULES[role] ?? [];
  const visible = allowedByRole.filter((moduleKey) => {
    const requiredPlan = MODULE_PLAN_REQUIREMENTS[moduleKey];
    return !requiredPlan || planMeets(planTier, requiredPlan);
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
