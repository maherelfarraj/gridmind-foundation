import { describe, expect, it } from "vitest";

import adminEn from "@/lib/i18n/adminops.en.json";
import adminAr from "@/lib/i18n/adminops.ar.json";
import { adminAuditActionI18nKey } from "@/lib/dashboard.rules";

function stripPluralSuffix(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, "");
}

function flatten(obj: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") {
        for (const child of flatten(v, path)) out.add(child);
      } else {
        out.add(stripPluralSuffix(path));
      }
    }
  }
  return out;
}

describe("adminMod i18n catalog parity", () => {
  it("has identical keys in en and ar (ignoring plural suffixes)", () => {
    const enKeys = flatten(adminEn);
    const arKeys = flatten(adminAr);
    expect([...enKeys].sort()).toEqual([...arKeys].sort());
  });

  it("keeps the _module marker in Latin", () => {
    expect(adminEn._module).toBe("adminops");
    expect(adminAr._module).toBe("adminops");
  });
});

describe("approval decisions in Arabic", () => {
  it("translates Approve/Reject and the approval-required label", () => {
    expect(adminAr.approvals.approve).toBe("اعتماد");
    expect(adminAr.approvals.reject).toBe("رفض");
    expect(adminAr.approvals.approvalRequired).toBe("اعتماد مطلوب");
  });

  it("keeps English defaults for the same keys", () => {
    expect(adminEn.approvals.approve).toBe("Approve");
    expect(adminEn.approvals.reject).toBe("Reject");
    expect(adminEn.approvals.approvalRequired).toBe("Approval required");
  });
});

describe("role/enum display mapping never mutates stored values", () => {
  const STORED_ROLES = ["owner", "company_admin", "project_manager", "engineer"] as const;

  it("maps every stored role enum to an Arabic display label without changing the enum itself", () => {
    for (const role of STORED_ROLES) {
      // The stored value used as the lookup key must remain the Latin enum.
      expect(role).toBe(role.toLowerCase());
      expect(adminAr.settings.roles[role]).toBeTruthy();
      expect(adminAr.settings.roles[role]).not.toBe(role);
    }
  });

  it("has a matching English display label for every role key present in Arabic", () => {
    const enRoleKeys = Object.keys(adminEn.settings.roles).sort();
    const arRoleKeys = Object.keys(adminAr.settings.roles).sort();
    expect(enRoleKeys).toEqual(arRoleKeys);
  });
});

describe("audit action key coverage", () => {
  const SAMPLE_ACTIONS = [
    "construction.cwp_created",
    "governance.method_statement_submitted",
    "governance.ptw_issued",
    "changes.moc_approved",
    "digital_thread.impact_resolved",
    "admin.tenant_suspended",
  ];

  it("maps admin-domain audit actions to adminMod.auditActions.<key> translation keys", () => {
    for (const action of SAMPLE_ACTIONS) {
      const key = adminAuditActionI18nKey(action);
      expect(key).not.toBeNull();
      const tail = key!.replace("adminMod.auditActions.", "");
      expect(adminEn.auditActions[tail as keyof typeof adminEn.auditActions]).toBeTruthy();
      expect(adminAr.auditActions[tail as keyof typeof adminAr.auditActions]).toBeTruthy();
    }
  });

  it("returns null for actions outside the admin/construction/governance/MOC domain", () => {
    expect(adminAuditActionI18nKey("vendor_portal.delivery_proposed")).toBeNull();
    expect(adminAuditActionI18nKey("created")).toBeNull();
  });

  it("has parity between en and ar audit action keys", () => {
    expect(Object.keys(adminEn.auditActions).sort()).toEqual(
      Object.keys(adminAr.auditActions).sort(),
    );
  });
});
