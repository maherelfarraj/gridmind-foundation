// Hardening — accessibility semantics and filter/pagination correctness for the
// Portfolio Cost & Close governance surfaces (audit trail, saved views).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The table is rendered outside a router in these semantic proofs; the stub keeps
// anchor semantics (href, aria-label, focus order) that the assertions care about.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to);
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { AuditTrailTable } from "@/components/portfolio/audit-trail-table";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import {
  actionsForFilter,
  AUDIT_ACTION_KEYS,
  auditFilterSchema,
  specOf,
  type AuditEvent,
} from "@/lib/portfolio-audit.rules";
import { portfolioAuditQueryOptions } from "@/lib/portfolio-governance.query";

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  created_at: "2026-07-14T09:30:00.000Z",
  actor_id: "bbbbbbbb-1111-4111-8111-111111111111",
  actor_name: "Maher El Farraj",
  action: "period_close",
  group: "period",
  severity: "critical",
  entity: "costing_periods",
  entity_id: "cccccccc-1111-4111-8111-111111111111",
  company_id: "dddddddd-1111-4111-8111-111111111111",
  project_id: "eeeeeeee-1111-4111-8111-111111111111",
  project_code: "GSI-EAM-001",
  period: "2026-06-01",
  reason: "Month-end close",
  correlation_id: "corr-42",
  metadata: {},
  diff: [{ field: "state", before: "soft_locked", after: "closed" }],
  gap: null,
  ...over,
});

const render = (node: React.ReactNode, locale?: "en" | "ar") =>
  renderToStaticMarkup(
    <LocaleProvider {...(locale ? { initialLocale: locale } : {})}>{node}</LocaleProvider>,
  );

describe("audit trail table accessibility semantics", () => {
  it("captions the table and scopes every column header", () => {
    const html = render(<AuditTrailTable events={[event()]} period="2026-06-01" />);
    expect(html).toContain("<caption");
    expect(html).toContain("sr-only");
    expect(html.match(/scope="col"/g)?.length).toBe(6);
  });

  it("conveys severity as text, never colour alone", () => {
    const html = render(<AuditTrailTable events={[event({ severity: "warning" })]} />);
    expect(html).toContain("Warning");
  });

  it("names the destination of each project scope link", () => {
    const html = render(<AuditTrailTable events={[event()]} />);
    expect(html).toContain('aria-label="Open costing close for project GSI-EAM-001"');
  });

  it("prefixes audit gaps with a screen-reader label", () => {
    const html = render(<AuditTrailTable events={[event({ gap: "unknown_project" })]} />);
    expect(html).toContain("Audit gap:");
  });

  it("exposes machine-readable timestamps", () => {
    const html = render(<AuditTrailTable events={[event()]} />);
    expect(html).toContain('<time dateTime="2026-07-14T09:30:00.000Z"');
  });

  it("renders right-to-left in Arabic without losing semantics", () => {
    const html = render(<AuditTrailTable events={[event()]} />, "ar");
    expect(html).toContain('scope="col"');
    expect(html).toContain("GSI-EAM-001");
  });
});

describe("audit filter resolution", () => {
  it("returns the full catalog when nothing is filtered", () => {
    expect(actionsForFilter({}).length).toBe(AUDIT_ACTION_KEYS.length);
  });

  it("resolves severity into the query allowlist so counts match the page", () => {
    const critical = actionsForFilter({ severity: "critical" });
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.length).toBeLessThan(AUDIT_ACTION_KEYS.length);
    expect(critical.every((a) => specOf(a)?.severity === "critical")).toBe(true);
  });

  it("intersects group, severity and action rather than overriding", () => {
    const both = actionsForFilter({ group: "period", severity: "critical" });
    expect(both.every((a) => specOf(a)?.group === "period")).toBe(true);
    expect(both.every((a) => specOf(a)?.severity === "critical")).toBe(true);

    const exact = actionsForFilter({ action: "period_close", group: "fx" });
    expect(exact).toEqual([]);
  });

  it("never widens beyond the portfolio catalog", () => {
    expect(actionsForFilter({ action: "auth.login" })).toEqual([]);
  });
});

describe("audit query keys", () => {
  it("normalises pagination defaults so equivalent filters share one cache entry", () => {
    const a = portfolioAuditQueryOptions(auditFilterSchema.parse({ period: "2026-06-01" }));
    const b = portfolioAuditQueryOptions(
      auditFilterSchema.parse({ period: "2026-06-01", page: 1, page_size: 50 }),
    );
    expect(JSON.stringify(a.queryKey)).toBe(JSON.stringify(b.queryKey));
  });

  it("keeps distinct pages on distinct keys", () => {
    const p1 = portfolioAuditQueryOptions(auditFilterSchema.parse({ page: 1 }));
    const p2 = portfolioAuditQueryOptions(auditFilterSchema.parse({ page: 2 }));
    expect(JSON.stringify(p1.queryKey)).not.toBe(JSON.stringify(p2.queryKey));
  });
});
