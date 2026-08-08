// GC-16c — governed deadline calendars: resolution chain (request → contract
// policy → company policy), provenance persistence, MENA weekend/holiday and
// DST boundaries, no silent fallback, optimistic concurrency and idempotent
// replay. In-memory Supabase double — no database, no network.
import { beforeEach, describe, expect, it } from "vitest";

import { createFakeSupabase, type Row, type Tables } from "../helpers/fake-supabase";
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  GOVERNED_CALENDARS,
  GOVERNED_CALENDAR_IDS,
  GOVERNED_CALENDAR_VERSION,
  addBusinessDays,
  isGovernedCalendarId,
  resolveGovernedCalendar,
  resolveGovernedTimezone,
  zonedTodayIso,
} from "@/lib/contracts-claims.rules";
import {
  loadClaimsAppendix,
  loadClaimsWorkspace,
  saveDeadline,
} from "@/lib/contracts-claims.server";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const USER = "44444444-4444-4444-8444-444444444444";

const COLUMN_DEFAULTS: Record<string, Row> = {
  contract_deadlines: { status: "open" },
  contract_claims: { status: "draft" },
  contract_claim_alerts: { state: "open" },
};

function withRowVersionTrigger(client: ReturnType<typeof createFakeSupabase>) {
  const from = client.from.bind(client);
  client.from = (table: string) => {
    const q = from(table);
    const insert = q.insert.bind(q);
    const update = q.update.bind(q);
    const defaults: Row = { row_version: 1, ...(COLUMN_DEFAULTS[table] ?? {}) };
    q.insert = (payload: Row | Row[]) =>
      insert(
        Array.isArray(payload)
          ? payload.map((r) => ({ ...defaults, ...r }))
          : { ...defaults, ...payload },
      );
    q.update = (payload: Row) =>
      update({ ...payload, row_version: Number(payload["row_version"] ?? 0) + 1 });
    return q;
  };
  return client;
}

function seed(overrides: Partial<Tables> = {}): Tables {
  return {
    projects: [{ id: PROJECT, company_id: COMPANY, name: "East Amman 50 MW PV" }],
    project_financial_config: [{ project_id: PROJECT, currency_code: "USD" }],
    contracts: [{ id: "ct-1", project_id: PROJECT, value: 1_000_000, status: "active" }],
    change_orders: [],
    bond_instruments: [],
    fx_rates: [],
    costing_settings: [],
    contract_claims: [],
    contract_claim_events: [],
    contract_claim_valuations: [],
    contract_deadlines: [],
    contract_claim_snapshots: [],
    contract_claim_snapshot_lines: [],
    contract_claim_alerts: [],
    ...overrides,
  } as Tables;
}

function makeCtx(overrides: Partial<Tables> = {}) {
  const client = withRowVersionTrigger(
    createFakeSupabase(seed(overrides), {
      rpc: { has_company_role: () => true, write_audit_log: () => null },
    }),
  );
  const ctx = { user: { id: USER }, supabase: client } as unknown as AuthContext;
  return { ctx, tables: client.db as Tables };
}

async function expectHttp(fn: () => Promise<unknown>, code: string, status: number) {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected rejection with ${code}`).toBeTruthy();
  const err = caught as { body?: string; statusCode?: number };
  expect(String(err.body)).toContain(code);
  expect(err.statusCode).toBe(status);
}

const BASE = {
  project_id: PROJECT,
  kind: "notice" as const,
  label: "Clause 20.1 notice",
  trigger_date: "2026-06-04",
  duration_days: 1,
  calendar: "business" as const,
};

describe("GC-16c governed calendar registry", () => {
  it("exposes a deterministic id + version for every governed calendar", () => {
    for (const id of GOVERNED_CALENDAR_IDS) {
      const cal = GOVERNED_CALENDARS[id];
      expect(cal.id).toBe(id);
      expect(cal.version).toBe(GOVERNED_CALENDAR_VERSION);
      expect(cal.timezones.length).toBeGreaterThan(0);
      expect(isGovernedCalendarId(id)).toBe(true);
    }
  });

  it("refuses a missing or unknown calendar instead of falling back", () => {
    expect(() => resolveGovernedCalendar(null)).toThrow(/deadline_calendar_unresolved|configured/);
    expect(() => resolveGovernedCalendar("")).toThrow();
    expect(() => resolveGovernedCalendar("made-up")).toThrow(/Unknown governed work calendar/);
  });

  it("refuses a timezone that is invalid or not governed for the calendar", () => {
    const jo = GOVERNED_CALENDARS["mena-jo"];
    expect(() => resolveGovernedTimezone(jo, "Not/AZone")).toThrow(/not a valid IANA timezone/);
    expect(() => resolveGovernedTimezone(jo, "America/New_York")).toThrow(/not governed/);
    expect(resolveGovernedTimezone(jo, "Asia/Amman")).toBe("Asia/Amman");
  });

  it("keeps MENA weekends and holidays deterministic", () => {
    // Thursday 2026-06-04 + 1 business day → Sunday under Fri/Sat weekend.
    expect(addBusinessDays("2026-06-04", 1, GOVERNED_CALENDARS["mena-jo"])).toBe("2026-06-07");
    expect(addBusinessDays("2026-06-04", 1, GOVERNED_CALENDARS["iso-std"])).toBe("2026-06-05");
    // 2026-05-01 (Fri, holiday + weekend in JO) is skipped.
    expect(addBusinessDays("2026-04-30", 1, GOVERNED_CALENDARS["mena-jo"])).toBe("2026-05-03");
  });

  it("computes zoned 'today' across a DST boundary without shifting a day", () => {
    // 2026-03-29 01:30 UTC — Europe/London springs forward at 01:00 UTC.
    const ms = Date.parse("2026-03-29T01:30:00Z");
    expect(zonedTodayIso("UTC", ms)).toBe("2026-03-29");
    expect(zonedTodayIso("Europe/London", ms)).toBe("2026-03-29");
    // Late UTC evening is already the next day in Asia/Amman.
    const evening = Date.parse("2026-06-04T22:30:00Z");
    expect(zonedTodayIso("UTC", evening)).toBe("2026-06-04");
    expect(zonedTodayIso("Asia/Amman", evening)).toBe("2026-06-05");
  });
});

describe("GC-16c calendar resolution chain", () => {
  it("honours an explicit request calendar with provenance 'request'", async () => {
    const { ctx, tables } = makeCtx();
    const res = await saveDeadline(ctx, {
      ...BASE,
      calendar_id: "mena-jo",
      timezone: "Asia/Amman",
    });
    expect(res.calendar_id).toBe("mena-jo");
    expect(res.calendar_source).toBe("request");
    expect(res.calendar_version).toBe(GOVERNED_CALENDAR_VERSION);
    expect(res.timezone).toBe("Asia/Amman");
    expect(res.due_date).toBe("2026-06-07");
    const row = tables.contract_deadlines![0]!;
    expect(row["calendar_id"]).toBe("mena-jo");
    expect(row["calendar_version"]).toBe(GOVERNED_CALENDAR_VERSION);
    expect(row["calendar_source"]).toBe("request");
    expect(row["timezone"]).toBe("Asia/Amman");
    const event = tables.contract_claim_events!.at(-1)!;
    expect(JSON.stringify(event)).toContain("mena-jo");
  });

  it("falls to the contract policy when the request omits a calendar", async () => {
    const { ctx } = makeCtx({
      contracts: [
        {
          id: "ct-1",
          project_id: PROJECT,
          value: 1,
          status: "active",
          deadline_calendar_id: "mena-gulf",
          deadline_timezone: "Asia/Dubai",
        },
      ],
    });
    const res = await saveDeadline(ctx, { ...BASE, contract_id: "ct-1" });
    expect(res.calendar_id).toBe("mena-gulf");
    expect(res.calendar_source).toBe("contract_policy");
    expect(res.timezone).toBe("Asia/Dubai");
    expect(res.due_date).toBe("2026-06-07");
  });

  it("falls to the company policy when neither request nor contract governs", async () => {
    const { ctx } = makeCtx({
      costing_settings: [
        { company_id: COMPANY, deadline_calendar_id: "mena-eg", deadline_timezone: "Africa/Cairo" },
      ],
    });
    const res = await saveDeadline(ctx, BASE);
    expect(res.calendar_id).toBe("mena-eg");
    expect(res.calendar_source).toBe("company_policy");
    expect(res.timezone).toBe("Africa/Cairo");
  });

  it("returns a governed 422 when no calendar is configured anywhere", async () => {
    const { ctx } = makeCtx();
    await expectHttp(() => saveDeadline(ctx, BASE), "deadline_calendar_unresolved", 422);
  });

  it("returns a governed 422 for an ungoverned timezone", async () => {
    const { ctx } = makeCtx();
    await expectHttp(
      () => saveDeadline(ctx, { ...BASE, calendar_id: "mena-jo", timezone: "America/New_York" }),
      "deadline_timezone_not_governed",
      422,
    );
  });
});

describe("GC-16c persistence, concurrency and replay", () => {
  let ctx: AuthContext;
  let tables: Tables;

  beforeEach(() => {
    const made = makeCtx();
    ctx = made.ctx;
    tables = made.tables;
  });

  it("re-computes the due date when the calendar changes and preserves provenance", async () => {
    const created = await saveDeadline(ctx, {
      ...BASE,
      calendar_id: "iso-std",
      timezone: "UTC",
    });
    expect(created.due_date).toBe("2026-06-05");
    const version = Number(tables.contract_deadlines![0]!["row_version"]);
    const updated = await saveDeadline(ctx, {
      ...BASE,
      id: created.id,
      calendar_id: "mena-jo",
      timezone: "Asia/Amman",
      row_version: version,
    });
    expect(updated.due_date).toBe("2026-06-07");
    const row = tables.contract_deadlines![0]!;
    expect(row["calendar_id"]).toBe("mena-jo");
    expect(row["calendar_version"]).toBe(GOVERNED_CALENDAR_VERSION);
  });

  it("rejects a stale write on a calendar change", async () => {
    const created = await saveDeadline(ctx, { ...BASE, calendar_id: "iso-std", timezone: "UTC" });
    const stale = Number(tables.contract_deadlines![0]!["row_version"]) + 3;
    await expectHttp(
      () =>
        saveDeadline(ctx, {
          ...BASE,
          id: created.id,
          calendar_id: "mena-jo",
          timezone: "Asia/Amman",
          row_version: stale,
        }),
      "stale_write",
      409,
    );
  });

  it("is idempotent on replay of an identical payload", async () => {
    const created = await saveDeadline(ctx, {
      ...BASE,
      calendar_id: "mena-jo",
      timezone: "Asia/Amman",
    });
    const version = Number(tables.contract_deadlines![0]!["row_version"]);
    const replay = await saveDeadline(ctx, {
      ...BASE,
      id: created.id,
      calendar_id: "mena-jo",
      timezone: "Asia/Amman",
      row_version: version,
    });
    expect(replay.due_date).toBe(created.due_date);
    expect(replay.calendar_id).toBe(created.calendar_id);
    expect(replay.calendar_version).toBe(created.calendar_version);
    expect(tables.contract_deadlines!.length).toBe(1);
  });

  it("surfaces provenance through the workspace and the pack appendix", async () => {
    await saveDeadline(ctx, {
      ...BASE,
      trigger_date: new Date().toISOString().slice(0, 10),
      duration_days: 5,
      calendar_id: "mena-jo",
      timezone: "Asia/Amman",
    });
    const ws = await loadClaimsWorkspace(ctx, PROJECT);
    expect(ws.deadlines[0]!.calendar_id).toBe("mena-jo");
    expect(ws.deadlines[0]!.calendar_version).toBe(GOVERNED_CALENDAR_VERSION);
    expect(ws.deadlines[0]!.timezone).toBe("Asia/Amman");
    const appendix = await loadClaimsAppendix(ctx, PROJECT);
    const upcoming = appendix.upcoming_deadlines[0]!;
    expect(upcoming.calendar_id).toBe("mena-jo");
    expect(upcoming.calendar_version).toBe(GOVERNED_CALENDAR_VERSION);
    expect(upcoming.timezone).toBe("Asia/Amman");
  });
});
