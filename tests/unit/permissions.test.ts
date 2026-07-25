// P-130 — Permissions matrix: every app_role has a defined module set,
// plan tier gates Green H₂, external viewers are portal-only, and the
// 9 fixed departments map to the correct *_admin roles.
import { describe, it, expect } from "vitest";
import {
  ROLE_MODULE_MAP,
  DEPARTMENTS,
  getVisibleModules,
  ROLE_TO_MODULES,
} from "@/lib/permissions";
import type { AppRole } from "@/lib/role-groups";

const ALL_APP_ROLES: readonly AppRole[] = [
  "super_admin",
  "company_admin",
  "billing_admin",
  "project_admin",
  "engineering_admin",
  "procurement_admin",
  "construction_admin",
  "hse_admin",
  "finance_admin",
  "legal_admin",
  "om_admin",
  "scada_admin",
  "engineer",
  "sales",
  "procurement_officer",
  "foreman",
  "field_technician",
  "client_viewer",
  "investor_viewer",
  "lender_viewer",
];

describe("ROLE_MODULE_MAP", () => {
  it("contains an entry for every one of the 20 app_role values", () => {
    expect(ALL_APP_ROLES).toHaveLength(20);
    for (const role of ALL_APP_ROLES) {
      expect(ROLE_MODULE_MAP[role], `missing map entry for ${role}`).toBeDefined();
    }
    expect(Object.keys(ROLE_MODULE_MAP).sort()).toEqual([...ALL_APP_ROLES].sort());
  });

  it("admin module only for super_admin / company_admin", () => {
    const admins: AppRole[] = ["super_admin", "company_admin"];
    for (const role of ALL_APP_ROLES) {
      const hasAdmin = ROLE_MODULE_MAP[role].includes("admin");
      const shouldHaveAdmin =
        admins.includes(role) ||
        // billing/project admins also inherit the admin nav (built via ALL_ADMIN_VISIBLE)
        role === "billing_admin" ||
        role === "project_admin";
      if (shouldHaveAdmin) {
        expect(hasAdmin, `${role} should see Admin`).toBe(true);
      } else {
        expect(hasAdmin, `${role} must NOT see Admin`).toBe(false);
      }
    }
  });

  it("external viewers see ONLY portal-adjacent modules (no engineering/procurement/field/etc)", () => {
    const forbidden = [
      "engineering",
      "procurement",
      "field_qaqc",
      "commissioning",
      "om_scada",
      "green_hydrogen",
      "admin",
    ];
    for (const role of ["client_viewer", "investor_viewer", "lender_viewer"] as const) {
      const mods = ROLE_MODULE_MAP[role];
      expect(mods).toContain("portals");
      for (const bad of forbidden) {
        expect(mods, `${role} must not see ${bad}`).not.toContain(bad);
      }
    }
  });
});

describe("getVisibleModules (plan tier gating)", () => {
  it("hides green_hydrogen for starter and growth, shows for enterprise", () => {
    // ROLE_TO_MODULES covers the coarse Role type — use company_admin which
    // sees every core module by default.
    expect(getVisibleModules("company_admin", "starter").has("green_hydrogen")).toBe(false);
    expect(getVisibleModules("company_admin", "growth").has("green_hydrogen")).toBe(false);
    expect(getVisibleModules("company_admin", "enterprise").has("green_hydrogen")).toBe(true);
  });

  it("always includes admin for company_admin regardless of tier", () => {
    for (const tier of ["starter", "growth", "enterprise"] as const) {
      expect(getVisibleModules("company_admin", tier).has("admin")).toBe(true);
    }
  });

  it("exposes ROLE_TO_MODULES for the coarse Role type", () => {
    // Sanity — makes sure the plan-gating layer uses this list, not the fine-grained map.
    expect(ROLE_TO_MODULES.super_admin).toContain("admin");
    expect(ROLE_TO_MODULES.viewer).not.toContain("admin");
  });
});

describe("DEPARTMENTS registry", () => {
  it("has exactly 9 departments", () => {
    expect(DEPARTMENTS).toHaveLength(9);
  });

  it("billing → billing_admin and om → om_admin", () => {
    const byKey = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d]));
    expect(byKey.billing.adminRole).toBe("billing_admin");
    expect(byKey.om.adminRole).toBe("om_admin");
  });

  it("every department admin role maps <key>_admin exactly", () => {
    for (const d of DEPARTMENTS) {
      expect(d.adminRole).toBe(`${d.key}_admin`);
    }
  });

  it("department keys are unique and cover all 9 expected keys", () => {
    const keys = DEPARTMENTS.map((d) => d.key).sort();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "billing",
      "construction",
      "engineering",
      "finance",
      "hse",
      "legal",
      "om",
      "procurement",
      "scada",
    ]);
  });
});
