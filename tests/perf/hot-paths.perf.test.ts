// GC-15 — Seeded-volume performance evidence for the four costing hot paths.
//
// Everything runs inside ONE psql transaction that is ALWAYS rolled back
// (tests/perf/seed.sql opens it, this file appends probes and ends with
// ROLLBACK). No row is ever committed, so the fixture cannot pollute shared
// or production data and is tenant-isolated behind its own synthetic company.
//
// The probes assert the intended index-backed plan is SELECTED by the planner
// with default settings — enable_seqscan is never disabled — and capture
// EXPLAIN (ANALYZE, BUFFERS) evidence plus practical execution times.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);
const d = HAS_DB ? describe : describe.skip;

// Seeded volume: 40 projects x 24 periods x 3 versions = 2,880 snapshots per
// domain (960 live + 1,920 superseded) and 960 x 24 x 3 = 69,120 lines per
// domain — enough physical pages for the planner to make a real choice.
const SEED = {
  projects: 40,
  periods: 24,
  versions: 3,
  buckets: 24,
  lines_per_bucket: 3,
} as const;

const PROBE_PROJECT = 7;
const PROBE_PERIOD = 5;
const PROBE_VERSION = SEED.versions; // the live (submitted) version

type Probe = {
  key: string;
  title: string;
  sql: string;
  relation: string;
  /** Any one of these index names proves the hot path is index-backed. */
  allowedIndexes: string[];
  /** Practical upper bound for EXPLAIN ANALYZE execution time (ms). */
  budgetMs: number;
};

const PROBES: Probe[] = [
  {
    key: "cashflow_latest_snapshot",
    title: "latest cashflow snapshot by project / period / version",
    relation: "cashflow_snapshots",
    allowedIndexes: ["cashflow_snapshots_project_idx", "cashflow_snapshots_active_idx"],
    budgetMs: 50,
    sql: `select id, period_month, version_no, status
            from public.cashflow_snapshots
           where project_id = md5('gc15-perf::project::${PROBE_PROJECT}')::uuid
           order by period_month desc, version_no desc
           limit 1`,
  },
  {
    key: "cashflow_bucket_drilldown",
    title: "cashflow snapshot-line bucket drilldown",
    relation: "cashflow_snapshot_lines",
    allowedIndexes: [
      "cashflow_lines_snapshot_idx",
      "cashflow_lines_cost_code_idx",
      "cashflow_lines_source_idx",
    ],
    budgetMs: 50,
    sql: `select bucket_start, direction, sum(amount_reporting) as amount
            from public.cashflow_snapshot_lines
           where snapshot_id = md5('gc15-perf::cs::${PROBE_PROJECT}::${PROBE_PERIOD}::${PROBE_VERSION}')::uuid
           group by bucket_start, direction
           order by bucket_start`,
  },
  {
    key: "recognition_latest_snapshot",
    title: "latest recognition snapshot by project / period",
    relation: "recognition_snapshots",
    allowedIndexes: ["recognition_snapshots_project_idx", "recognition_snapshots_active_idx"],
    budgetMs: 50,
    sql: `select id, period_month, version_no, status
            from public.recognition_snapshots
           where project_id = md5('gc15-perf::project::${PROBE_PROJECT}')::uuid
           order by period_month desc, version_no desc
           limit 1`,
  },
  {
    key: "recognition_line_lookup",
    title: "recognition snapshot-line lookup",
    relation: "recognition_snapshot_lines",
    allowedIndexes: [
      "recognition_lines_snapshot_idx",
      "recognition_lines_contract_idx",
      "recognition_lines_obligation_idx",
    ],
    budgetMs: 50,
    sql: `select label, method, period_revenue, sort_order
            from public.recognition_snapshot_lines
           where snapshot_id = md5('gc15-perf::rs::${PROBE_PROJECT}::${PROBE_PERIOD}::${PROBE_VERSION}')::uuid
           order by sort_order`,
  },
  {
    key: "claims_latest_snapshot",
    title: "GC-16 latest contract-claim snapshot by project / period / version",
    relation: "contract_claim_snapshots",
    allowedIndexes: [
      "contract_claim_snapshots_project_idx",
      "contract_claim_snapshots_active_idx",
    ],
    budgetMs: 50,
    sql: `select id, period_month, version_no, status
            from public.contract_claim_snapshots
           where project_id = md5('gc15-perf::project::${PROBE_PROJECT}')::uuid
           order by period_month desc, version_no desc
           limit 1`,
  },
  {
    key: "claims_line_drilldown",
    title: "GC-16 contract-claim snapshot-line drilldown",
    relation: "contract_claim_snapshot_lines",
    allowedIndexes: ["contract_claim_lines_snapshot_idx", "contract_claim_lines_claim_idx"],
    budgetMs: 50,
    sql: `select label, kind, status, approved_amount, exposure_reporting, sort_order
            from public.contract_claim_snapshot_lines
           where snapshot_id = md5('gc16-perf::ccs::${PROBE_PROJECT}::${PROBE_PERIOD}::${PROBE_VERSION}')::uuid
           order by sort_order`,
  },
  {
    key: "claims_project_register",
    title: "GC-16 open contract-claim register by project",
    relation: "contract_claims",
    allowedIndexes: [
      "contract_claims_project_idx",
      "contract_claims_company_idx",
      // The planner may prefer the narrower unique (project_id, claim_ref)
      // index for this predicate; either choice is index-backed.
      "contract_claims_project_id_claim_ref_key",
    ],
    budgetMs: 50,
    sql: `select claim_ref, status, approved_amount, at_risk_amount, updated_at
            from public.contract_claims
           where project_id = md5('gc15-perf::project::${PROBE_PROJECT}')::uuid
             and status in ('submitted','assessed','approved')
           order by updated_at desc
           limit 50`,
  },
];

const SEED_SQL = path.resolve(__dirname, "seed.sql");

type Result = {
  counts: Record<string, number>;
  plans: Record<string, string>;
};

/**
 * Seed, probe, and roll back in a single psql session. Returns the captured
 * EXPLAIN text per probe. The transaction is opened by seed.sql and closed by
 * the trailing ROLLBACK below; psql also aborts (never commits) on error
 * because ON_ERROR_STOP is set.
 */
function runFixture(): Result {
  const vars = Object.entries(SEED)
    .map(([k, v]) => `\\set ${k} ${v}`)
    .join("\n");

  const probes = PROBES.map(
    (p) => `\\echo #PROBE ${p.key}
explain (analyze, buffers) ${p.sql};
\\echo #ENDPROBE`,
  ).join("\n");

  const counts = [
    "cashflow_snapshots",
    "cashflow_snapshot_lines",
    "recognition_snapshots",
    "recognition_snapshot_lines",
    "contract_claims",
    "contract_claim_snapshots",
    "contract_claim_snapshot_lines",
  ]
    .map((t) => `select 'COUNT:${t}:' || count(*) from public.${t};`)
    .join("\n");

  const script = `\\set ON_ERROR_STOP on
${vars}
\\i ${SEED_SQL}
${counts}
${probes}
rollback;`;

  const out = execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: script,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const counted: Record<string, number> = {};
  for (const line of out.split("\n")) {
    const m = /^COUNT:([a-z_]+):(\d+)$/.exec(line.trim());
    if (m) counted[m[1]] = Number(m[2]);
  }

  const plans: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("#PROBE ")) {
      current = line.slice(7).trim();
      buffer = [];
      continue;
    }
    if (line.startsWith("#ENDPROBE")) {
      if (current) plans[current] = buffer.join("\n");
      current = null;
      continue;
    }
    if (current) buffer.push(line);
  }

  return { counts: counted, plans };
}

function executionMs(plan: string): number {
  const m = /Execution Time: ([\d.]+) ms/.exec(plan);
  return m ? Number(m[1]) : Number.NaN;
}

d("GC-15 seeded-volume hot-path performance", () => {
  let result: Result;

  beforeAll(() => {
    result = runFixture();
    // EXPLAIN evidence is part of the deliverable; print it once.
    for (const probe of PROBES) {
      // eslint-disable-next-line no-console
      console.log(`\n--- ${probe.title} ---\n${result.plans[probe.key]}`);
    }
  }, 300_000);

  it("seeds a statistically representative volume inside the transaction", () => {
    const liveSnapshots = SEED.projects * SEED.periods;
    const allSnapshots = liveSnapshots * SEED.versions;
    const lines = liveSnapshots * SEED.buckets * SEED.lines_per_bucket;

    expect(result.counts.cashflow_snapshots).toBe(allSnapshots);
    expect(result.counts.recognition_snapshots).toBe(allSnapshots);
    expect(result.counts.cashflow_snapshot_lines).toBe(lines);
    expect(result.counts.recognition_snapshot_lines).toBe(lines);
    expect(result.counts.contract_claim_snapshots).toBe(allSnapshots);
    expect(result.counts.contract_claim_snapshot_lines).toBe(lines);
    expect(result.counts.contract_claims).toBe(SEED.projects * SEED.buckets);
    expect(lines).toBeGreaterThan(50_000);
  });

  for (const probe of PROBES) {
    describe(probe.title, () => {
      it("selects an index-backed plan (seqscan never disabled)", () => {
        const plan = result.plans[probe.key];
        expect(plan, `missing plan for ${probe.key}`).toBeTruthy();
        expect(plan).toMatch(new RegExp(`Index (Only )?Scan|Bitmap Index Scan`));
        expect(plan).not.toMatch(new RegExp(`Seq Scan on ${probe.relation}\\b`));
        const used = probe.allowedIndexes.some((idx) => plan.includes(idx));
        expect(used, `expected one of ${probe.allowedIndexes.join(", ")} in:\n${plan}`).toBe(true);
      });

      it("reports buffer accounting and stays inside its execution budget", () => {
        const plan = result.plans[probe.key];
        expect(plan).toContain("Buffers:");
        const ms = executionMs(plan);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeLessThan(probe.budgetMs);
      });
    });
  }

  it("leaves nothing behind after rollback", () => {
    const out = execFileSync(
      "psql",
      [
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `select
           (select count(*) from public.companies where slug = 'gc15-perf-fixture')
         + (select count(*) from public.projects where code like 'GC15-PERF-%')
         + (select count(*) from public.cashflow_snapshots s
              join public.companies c on c.id = s.company_id where c.slug = 'gc15-perf-fixture')
         + (select count(*) from public.recognition_snapshots s
              join public.companies c on c.id = s.company_id where c.slug = 'gc15-perf-fixture')
         + (select count(*) from public.contract_claims cl
              join public.companies c on c.id = cl.company_id where c.slug = 'gc15-perf-fixture')
         + (select count(*) from public.contract_claim_snapshots s
              join public.companies c on c.id = s.company_id where c.slug = 'gc15-perf-fixture')`,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(Number(out)).toBe(0);
  });
});
