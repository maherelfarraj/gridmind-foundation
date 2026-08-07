// GC-09 — Portfolio governance: audit-trail redaction/filtering and saved views.
import { describe, expect, it } from "vitest";

import {
  buildAuditCsv,
  buildDiff,
  auditFilterSchema,
  isPortfolioAuditAction,
  reconcileAudit,
  redactMetadata,
  specOf,
  type AuditEvent,
} from "@/lib/portfolio-audit.rules";
import {
  canMutateView,
  configToSearch,
  DEFAULT_SAVED_VIEW_CONFIG,
  parseSavedViewConfig,
  resolveEntrySearch,
  savedViewConfigSchema,
  savedViewCreateSchema,
  searchToConfig,
  type SavedView,
} from "@/lib/portfolio-views.rules";

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: over.id ?? "e1",
    created_at: "2026-04-01T10:00:00Z",
    actor_id: "u1",
    actor_name: "Maher",
    action: "costing.forecast_version.approve",
    group: "forecast",
    severity: "critical",
    entity: "forecast_versions",
    entity_id: "v1",
    company_id: "c1",
    project_id: "p1",
    project_code: "GSI-EAM-001",
    period: "2026-03-01",
    reason: null,
    correlation_id: null,
    metadata: {},
    diff: [],
    gap: null,
    ...over,
  };
}

describe("audit action catalogue", () => {
  it("only surfaces allowlisted portfolio actions", () => {
    expect(isPortfolioAuditAction("costing.forecast_version.approve")).toBe(true);
    expect(isPortfolioAuditAction("invite.created")).toBe(false);
    expect(specOf("period.close")?.severity).toBe("critical");
  });
});

describe("metadata redaction", () => {
  it("drops anything outside the allowlist", () => {
    const out = redactMetadata({
      period: "2026-03-01",
      access_token: "secret-token",
      payload: { password: "hunter2" },
      note: "approved by CFO",
    });
    expect(out).toEqual({ period: "2026-03-01", note: "approved by CFO" });
    expect(JSON.stringify(out)).not.toContain("secret-token");
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("keeps before/after pairs but strips their unsafe fields", () => {
    const out = redactMetadata({
      before: { status: "submitted", secret: "x" },
      after: { status: "approved", secret: "y" },
    });
    expect(out["before"]).toEqual({ status: "submitted" });
    expect(out["after"]).toEqual({ status: "approved" });
  });

  it("ignores non-object metadata", () => {
    expect(redactMetadata(null)).toEqual({});
    expect(redactMetadata("nope")).toEqual({});
  });
});

describe("structured diff", () => {
  it("reports only changed fields from before/after", () => {
    const diff = buildDiff(
      redactMetadata({
        before: { status: "submitted", version_no: 2 },
        after: { status: "approved", version_no: 2 },
      }),
    );
    expect(diff).toEqual([{ field: "status", before: "submitted", after: "approved" }]);
  });

  it("understands from_/to_ state pairs", () => {
    const diff = buildDiff(redactMetadata({ from_state: "open", to_state: "soft_locked" }));
    expect(diff).toEqual([{ field: "state", before: "open", after: "soft_locked" }]);
  });
});

describe("audit filters", () => {
  it("defaults pagination and rejects unknown keys", () => {
    const parsed = auditFilterSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.page_size).toBe(50);
    expect(auditFilterSchema.safeParse({ evil: 1 }).success).toBe(false);
    expect(auditFilterSchema.safeParse({ page_size: 5000 }).success).toBe(false);
    expect(auditFilterSchema.safeParse({ from: "2026-03" }).success).toBe(false);
  });
});

describe("audit reconciliation", () => {
  it("counts gaps rather than hiding them", () => {
    const rec = reconcileAudit(
      [
        event(),
        event({ id: "e2", gap: "unknown_project", severity: "warning", group: "fx" }),
        event({ id: "e3", gap: "unattributed", actor_id: null, actor_name: null }),
      ],
      42,
    );
    expect(rec.total).toBe(42);
    expect(rec.page_count).toBe(3);
    expect(rec.gaps).toBe(2);
    expect(rec.actors).toBe(1);
    expect(rec.gap_kinds).toEqual(
      expect.arrayContaining([
        { kind: "unknown_project", count: 1 },
        { kind: "unattributed", count: 1 },
      ]),
    );
  });
});

describe("audit CSV", () => {
  it("is deterministic and escapes separators", () => {
    const csv = buildAuditCsv([event({ reason: 'CFO said "go, now"' })]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "timestamp,actor,action,group,severity,entity,entity_id,project_code,period,reason,diff,correlation_id,gap",
    );
    expect(lines[1]).toContain('"CFO said ""go, now"""');
    expect(buildAuditCsv([event()])).toBe(buildAuditCsv([event()]));
  });
});

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
function view(over: Partial<SavedView> = {}): SavedView {
  return {
    id: "v1",
    name: "Q1 official",
    description: null,
    config: savedViewConfigSchema.parse({ period: "2026-03-01", currency: "USD" }),
    config_version: 1,
    is_shared: false,
    is_default: true,
    owner_id: "u1",
    owner_name: "Maher",
    is_owner: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...over,
  };
}

describe("saved view configuration", () => {
  it("rejects unknown keys instead of storing them", () => {
    expect(savedViewConfigSchema.safeParse({ period: "2026-03-01", drop: "table" }).success).toBe(
      false,
    );
  });

  it("rejects malformed period and currency", () => {
    expect(savedViewConfigSchema.safeParse({ period: "2026-03" }).success).toBe(false);
    expect(savedViewConfigSchema.safeParse({ currency: "usd" }).success).toBe(false);
  });

  it("degrades to defaults when a persisted config is invalid", () => {
    expect(parseSavedViewConfig({ basis: "nonsense" })).toEqual(DEFAULT_SAVED_VIEW_CONFIG);
    expect(parseSavedViewConfig(null).version).toBe(1);
  });

  it("stores no calculated balances", () => {
    const keys = Object.keys(DEFAULT_SAVED_VIEW_CONFIG);
    for (const banned of ["eac", "vac", "totals", "committed"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("trims and normalises the view name", () => {
    expect(savedViewCreateSchema.parse({ name: "  Q1   official ", config: {} }).name).toBe(
      "Q1 official",
    );
    expect(savedViewCreateSchema.safeParse({ name: "   ", config: {} }).success).toBe(false);
  });
});

describe("saved view URL round-trip", () => {
  it("emits only URL-addressable filters", () => {
    expect(configToSearch(view().config)).toEqual({ period: "2026-03-01", currency: "USD" });
    expect(configToSearch(savedViewConfigSchema.parse({ basis: "latest" })).basis).toBe("latest");
  });

  it("round-trips through search params", () => {
    const cfg = searchToConfig({ period: "2026-05-01", currency: "EUR", basis: "latest" });
    expect(configToSearch(cfg)).toEqual({
      period: "2026-05-01",
      currency: "EUR",
      basis: "latest",
    });
  });

  it("lets explicit URL params win over the default view", () => {
    const resolved = resolveEntrySearch({ period: "2026-06-01" }, view());
    expect(resolved.period).toBe("2026-06-01");
    expect(resolved.currency).toBe("USD");
  });

  it("applies the default view when the URL is bare", () => {
    expect(resolveEntrySearch({}, view()).period).toBe("2026-03-01");
    expect(resolveEntrySearch({}, null)).toEqual({});
  });
});

describe("saved view ownership", () => {
  it("allows only the owner to mutate", () => {
    expect(canMutateView(view(), "u1")).toBe(true);
    expect(canMutateView(view({ owner_id: "u2", is_shared: true }), "u1")).toBe(false);
  });
});
