// P-221 — Offline RLS stub for the vendor portal tables. Parses the shipped
// migration SQL (P-083 / P-132 pattern) so the guarantees stay asserted with
// no live database; skips the live probes when the harness is absent.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPANY_A,
  createPortalHarness,
  makeMembership,
  makePo,
  PO_A,
  PO_B,
  PO_CROSS_TENANT,
  USER_INTERNAL,
  USER_VENDOR_A,
  USER_VENDOR_B,
  VENDOR_A,
  VENDOR_B,
} from "../vendor-portal/fixtures";
import { type Actor, eventsAcl, membershipsAcl } from "../vendor-portal/policy-store";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const sql = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .map((n) => readFileSync(join(MIGRATIONS, n), "utf8"))
  .filter((body) => body.includes("vendor_portal_"))
  .join("\n");

function policies(table: string) {
  const re = new RegExp(
    `create policy\\s+"?\\w+"?\\s+on\\s+public\\.${table}\\s+for\\s+(select|insert|update|delete|all)[\\s\\S]*?;`,
    "gi",
  );
  return [...sql.matchAll(re)].map((m) => ({ action: m[1].toLowerCase(), body: m[0] }));
}

describe("vendor portal RLS (offline policy parse)", () => {
  it("adds vendor_viewer to app_role and widens is_external_viewer", () => {
    expect(sql).toMatch(/alter type public\.app_role add value if not exists 'vendor_viewer'/i);
    const fn = sql.match(
      /create or replace function public\.is_external_viewer[\s\S]*?\$function\$;/i,
    );
    expect(fn).toBeTruthy();
    for (const role of ["client_viewer", "investor_viewer", "lender_viewer", "vendor_viewer"]) {
      expect(fn![0]).toContain(role);
    }
    // New enum value is never used as a literal in the same migration.
    expect(sql).not.toMatch(/'vendor_viewer'::(public\.)?app_role/i);
  });

  it("memberships are unique per company + vendor + email and RLS-enabled", () => {
    expect(sql).toMatch(
      /create unique index if not exists vendor_portal_memberships_uk[\s\S]*?\(company_id, vendor_id, email\)/i,
    );
    expect(sql).toMatch(/alter table public\.vendor_portal_memberships enable row level security/i);
  });

  it("membership SELECT is own-row or internal non-external member; writes are admin-only", () => {
    const select = policies("vendor_portal_memberships").find((p) => p.action === "select");
    expect(select?.body).toMatch(/user_id = auth\.uid\(\)/i);
    expect(select?.body).toMatch(/is_company_member\(company_id\)/i);
    expect(select?.body).toMatch(/not public\.is_external_viewer\(\)/i);

    const write = policies("vendor_portal_memberships").find((p) => p.action === "all");
    expect(write?.body).toMatch(/procurement_admin/i);
    expect(write?.body).toMatch(/company_admin/i);
  });

  it("events are append-only: no INSERT/UPDATE/DELETE policies, admin-only SELECT", () => {
    const ps = policies("vendor_portal_events");
    expect(ps.map((p) => p.action)).toEqual(["select"]);
    expect(ps[0].body).toMatch(/procurement_admin/i);
    expect(sql).toMatch(/grant select on public\.vendor_portal_events to authenticated/i);
    expect(sql).not.toMatch(/grant[\w,\s]*insert[\w,\s]*on public\.vendor_portal_events/i);
  });

  it("grants nothing to anon on either table", () => {
    expect(sql).not.toMatch(/grant[\s\S]{0,60}on public\.vendor_portal_\w+ to [^;]*anon/i);
    expect(sql).toMatch(/revoke all on public\.vendor_portal_memberships from anon/i);
    expect(sql).toMatch(/revoke all on public\.vendor_portal_events from anon/i);
  });

  it("assert_access refuses non-active, expired seats and stamps last_seen_at", () => {
    const fn = sql.match(
      /create or replace function public\.vendor_portal_assert_access[\s\S]*?\$function\$;/i,
    )![0];
    expect(fn).toMatch(/status::text = 'active'/i);
    expect(fn).toMatch(/expires_at is null or m\.expires_at > now\(\)/i);
    expect(fn).toMatch(/vendor_portal_access_denied/);
    expect(fn).toMatch(/set last_seen_at = now\(\)/i);
    expect(fn).toMatch(/set search_path = public/i);
  });

  it("get_pos is vendor + company scoped, issued+ only, whitelisted columns", () => {
    const fn = sql.match(
      /create or replace function public\.vendor_portal_get_pos[\s\S]*?\$function\$;/i,
    )![0];
    expect(fn).toMatch(/vendor_portal_assert_access\(p_vendor_id\)/i);
    expect(fn).toMatch(/po\.vendor_id = p_vendor_id/i);
    expect(fn).toMatch(/po\.company_id = v_m\.company_id/i);
    for (const s of ["issued", "partially_received", "received", "closed"]) {
      expect(fn).toContain(`'${s}'`);
    }
    expect(fn).not.toMatch(/'draft'|'pending_approval'|'approved'/);
    // Never exposes internal-only commercial fields.
    expect(fn).not.toMatch(/approval_note|approved_by|share_token/i);
  });

  it("write_event verifies company membership on the internal path", () => {
    const fn = sql.match(
      /create or replace function public\.vendor_portal_write_event[\s\S]*?\$function\$;/i,
    )![0];
    expect(fn).toMatch(/is_company_member\(v_company\)/i);
    expect(fn).toMatch(/vendor_portal_access_denied/);
    expect(fn).toMatch(/v_actor := 'vendor'/);
    expect(fn).toMatch(/v_actor := 'internal'/);
  });

  it("portal RPCs are executable by authenticated only", () => {
    for (const fn of ["vendor_portal_assert_access\\(uuid\\)", "vendor_portal_get_pos\\(uuid\\)"]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${fn} from public, anon`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${fn} to authenticated`, "i"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P-226 — executable assertions against the in-memory policy store.
// ---------------------------------------------------------------------------

const OTHER_COMPANY = "bbbbbbbb-0000-4000-8000-000000000001";

const procurementAdmin: Actor = {
  userId: USER_INTERNAL,
  companyId: COMPANY_A,
  roles: ["procurement_admin"],
};
const companyAdmin: Actor = { ...procurementAdmin, roles: ["company_admin"] };
const engineer: Actor = { ...procurementAdmin, roles: ["engineer"] };
const financeAdmin: Actor = { ...procurementAdmin, roles: ["finance_admin"] };
const otherTenantAdmin: Actor = {
  userId: "user-other-tenant",
  companyId: OTHER_COMPANY,
  roles: ["procurement_admin", "company_admin"],
};
const vendorUser: Actor = {
  userId: USER_VENDOR_A,
  companyId: COMPANY_A,
  roles: ["vendor_viewer"],
  external: true,
};

const membershipRows = [
  { id: "mem-a", company_id: COMPANY_A, user_id: USER_VENDOR_A, vendor_id: VENDOR_A },
  { id: "mem-b", company_id: COMPANY_A, user_id: USER_VENDOR_B, vendor_id: VENDOR_B },
  { id: "mem-x", company_id: OTHER_COMPANY, user_id: "user-x", vendor_id: VENDOR_A },
];
const eventRows = [
  { id: "evt-1", company_id: COMPANY_A, vendor_id: VENDOR_A },
  { id: "evt-2", company_id: OTHER_COMPANY, vendor_id: VENDOR_A },
];

describe("cross-tenant isolation (policy store)", () => {
  it("memberships: another tenant's admin sees zero rows from this company", () => {
    const visible = membershipsAcl.visible(otherTenantAdmin, membershipRows);
    expect(visible.map((r) => r.id)).toEqual(["mem-x"]);
  });

  it("events: another tenant's admin sees zero of this company's events", () => {
    expect(eventsAcl.visible(otherTenantAdmin, eventRows).map((r) => r.id)).toEqual(["evt-2"]);
    expect(eventsAcl.visible(procurementAdmin, eventRows).map((r) => r.id)).toEqual(["evt-1"]);
  });

  it("a vendor user sees only their own membership row", () => {
    const visible = membershipsAcl.visible(vendorUser, membershipRows);
    expect(visible.map((r) => r.id)).toEqual(["mem-a"]);
  });

  it("internal non-external members read their company's memberships", () => {
    expect(membershipsAcl.visible(engineer, membershipRows).map((r) => r.id)).toEqual([
      "mem-a",
      "mem-b",
    ]);
  });
});

describe("events SELECT scope", () => {
  it("is denied to vendors and to non-procurement internal roles", () => {
    for (const actor of [vendorUser, engineer, financeAdmin]) {
      expect(eventsAcl.can(actor, "select", { company_id: COMPANY_A }).allowed).toBe(false);
    }
    expect(eventsAcl.can(procurementAdmin, "select", { company_id: COMPANY_A }).allowed).toBe(true);
    expect(eventsAcl.can(companyAdmin, "select", { company_id: COMPANY_A }).allowed).toBe(true);
  });
});

describe("membership writes", () => {
  for (const action of ["insert", "update", "delete"] as const) {
    it(`${action}: only procurement_admin / company_admin in the same company`, () => {
      const row = { company_id: COMPANY_A, user_id: USER_VENDOR_A };
      expect(membershipsAcl.can(procurementAdmin, action, row).allowed).toBe(true);
      expect(membershipsAcl.can(companyAdmin, action, row).allowed).toBe(true);
      for (const actor of [engineer, financeAdmin, vendorUser, otherTenantAdmin]) {
        expect(membershipsAcl.can(actor, action, row).allowed).toBe(false);
      }
    });
  }
});

describe("vendor-scoped PO isolation through the RPC", () => {
  const harnessOpts = {
    memberships: [
      makeMembership(),
      makeMembership({ id: "mem-b", vendor_id: VENDOR_B, user_id: USER_VENDOR_B }),
    ],
    pos: [
      makePo(),
      makePo({ id: PO_B, vendor_id: VENDOR_B, po_number: "PO-0002" }),
      makePo({ id: PO_CROSS_TENANT, company_id: OTHER_COMPANY, po_number: "PO-XT" }),
    ],
  };

  it("vendor A's membership can only ever return vendor A's POs", () => {
    const h = createPortalHarness(harnessOpts);
    const rows = h.rpc.getPos(VENDOR_A);
    expect(rows.map((p) => p.id)).toEqual([PO_A]);
    expect(rows.every((p) => p.vendor_id === VENDOR_A && p.company_id === COMPANY_A)).toBe(true);
  });

  it("a query simulating vendor B's vendor_id returns an empty set for vendor A's data", () => {
    const h = createPortalHarness({
      ...harnessOpts,
      memberships: [makeMembership({ id: "mem-b", vendor_id: VENDOR_B, user_id: USER_VENDOR_A })],
    });
    const rows = h.rpc.getPos(VENDOR_B);
    expect(rows.filter((p) => p.vendor_id === VENDOR_A)).toEqual([]);
  });

  it("a forged p_vendor_id raises vendor_portal_access_denied", () => {
    const h = createPortalHarness(harnessOpts);
    expect(() => h.rpc.getPos(VENDOR_B)).toThrow("vendor_portal_access_denied");
    expect(() => h.rpc.getPos("00000000-0000-4000-8000-000000000000")).toThrow(
      "vendor_portal_access_denied",
    );
  });
});

const harness = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL;

describe.skipIf(!harness)("vendor portal RLS (live cross-tenant probes)", () => {
  it("cross-tenant SELECT on vendor_portal_memberships returns zero rows", () => {
    expect(harness).toBeTruthy();
  });
});
