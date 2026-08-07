// GC-07 — Period Close Cockpit pure rules: progress, filters, SoD, gate and CSV.
import { describe, expect, it } from "vitest";

import {
  CLOSE_POLICY_DEFAULTS,
  buildChecklistCsv,
  buildExceptionsCsv,
  canTransitionItem,
  checklistProgress,
  closeGate,
  criticalPath,
  exceptionSeeds,
  filterChecklist,
  groupByCategory,
  isDone,
  isExceptionOpen,
  isOverdue,
  readinessFingerprint,
  staleExceptionIds,
  violatesSegregationOfDuties,
  type ChecklistItem,
  type CloseException,
} from "@/lib/costing.checklist";

const TODAY = "2026-03-10";

let seq = 0;
const item = (over: Partial<ChecklistItem> = {}): ChecklistItem => {
  seq += 1;
  return {
    id: `item-${seq}`,
    seq: seq * 10,
    category: "actuals",
    title: `Item ${seq}`,
    instructions: null,
    is_required: true,
    requires_evidence: false,
    owner_role: "finance_admin",
    due_date: "2026-03-05",
    status: "pending",
    assignee_id: null,
    reviewer_id: null,
    notes: null,
    completed_by: null,
    completed_at: null,
    reviewed_by: null,
    reviewed_at: null,
    waived_by: null,
    waived_at: null,
    waiver_reason: null,
    ready_at: null,
    row_version: 1,
    evidence_count: 0,
    ...over,
  };
};

const exception = (over: Partial<CloseException> = {}): CloseException => ({
  id: `exc-${Math.random().toString(36).slice(2, 8)}`,
  period_month: "2026-02-01",
  source: "readiness",
  exception_type: "draft_accruals",
  severity: "blocker",
  entity_table: null,
  entity_id: null,
  fingerprint: "readiness:draft_accruals",
  title: "Draft accruals",
  detail: { count: 2 },
  status: "open",
  owner_id: null,
  due_date: null,
  resolution_note: null,
  resolved_by: null,
  resolved_at: null,
  approved_by: null,
  approved_at: null,
  reopen_count: 0,
  first_seen_at: "2026-03-01T00:00:00Z",
  last_seen_at: "2026-03-01T00:00:00Z",
  row_version: 1,
  ...over,
});

describe("item state", () => {
  it("treats completed and waived as done", () => {
    expect(isDone(item({ status: "completed" }))).toBe(true);
    expect(isDone(item({ status: "waived" }))).toBe(true);
    expect(isDone(item({ status: "ready_for_review" }))).toBe(false);
  });

  it("flags overdue only for unfinished dated items", () => {
    expect(isOverdue(item({ due_date: "2026-03-05" }), TODAY)).toBe(true);
    expect(isOverdue(item({ due_date: "2026-03-05", status: "completed" }), TODAY)).toBe(false);
    expect(isOverdue(item({ due_date: "2026-03-20" }), TODAY)).toBe(false);
    expect(isOverdue(item({ due_date: null }), TODAY)).toBe(false);
  });
});

describe("progress", () => {
  it("counts done, required outstanding and overdue", () => {
    const items = [
      item({ status: "completed" }),
      item({ status: "waived" }),
      item({ status: "pending", due_date: "2026-03-01" }),
      item({ status: "in_progress", is_required: false, due_date: "2026-03-01" }),
    ];
    const p = checklistProgress(items, TODAY);
    expect(p.total).toBe(4);
    expect(p.done).toBe(2);
    expect(p.pct).toBe(50);
    expect(p.requiredOutstanding).toBe(1);
    expect(p.overdue).toBe(2);
  });

  it("returns a null percentage for an empty checklist", () => {
    expect(checklistProgress([], TODAY).pct).toBeNull();
  });
});

describe("critical path and grouping", () => {
  it("surfaces required, unfinished items by due date first", () => {
    const late = item({ due_date: "2026-03-01" });
    const soon = item({ due_date: "2026-03-08" });
    const undated = item({ due_date: null });
    const done = item({ due_date: "2026-02-01", status: "completed" });
    const optional = item({ due_date: "2026-02-02", is_required: false });
    const path = criticalPath([soon, done, late, undated, optional]);
    expect(path.map((i) => i.id)).toEqual([late.id, soon.id, undated.id]);
  });

  it("groups by category preserving sequence order", () => {
    const a = item({ category: "fx", seq: 40 });
    const b = item({ category: "actuals", seq: 10 });
    const c = item({ category: "fx", seq: 20 });
    const groups = groupByCategory([a, b, c]);
    expect(groups.map((g) => g.category)).toEqual(["actuals", "fx"]);
    expect(groups[1].items.map((i) => i.seq)).toEqual([20, 40]);
  });
});

describe("filters", () => {
  const done = item({ status: "completed", assignee_id: "u1", category: "fx" });
  const open = item({ status: "pending", assignee_id: "u2", category: "actuals" });
  const rows = [done, open];

  it("defaults to everything and narrows by status, owner and category", () => {
    expect(filterChecklist(rows, { status: "all", ownerId: "all", category: "all" })).toHaveLength(
      2,
    );
    expect(
      filterChecklist(rows, { status: "outstanding", ownerId: "all", category: "all" }).map(
        (i) => i.id,
      ),
    ).toEqual([open.id]);
    expect(
      filterChecklist(rows, { status: "completed", ownerId: "all", category: "all" }).map(
        (i) => i.id,
      ),
    ).toEqual([done.id]);
    expect(
      filterChecklist(rows, { status: "all", ownerId: "u2", category: "all" }).map((i) => i.id),
    ).toEqual([open.id]);
    expect(
      filterChecklist(rows, { status: "all", ownerId: "all", category: "fx" }).map((i) => i.id),
    ).toEqual([done.id]);
  });
});

describe("segregation of duties", () => {
  it("blocks the preparer from reviewing their own evidence-bearing item", () => {
    expect(
      violatesSegregationOfDuties({
        actorId: "u1",
        preparedBy: "u1",
        requiresEvidence: true,
        allowSelfReview: false,
      }),
    ).toBe(true);
  });

  it("allows a different reviewer, self-review policy, or items without evidence", () => {
    expect(
      violatesSegregationOfDuties({
        actorId: "u2",
        preparedBy: "u1",
        requiresEvidence: true,
        allowSelfReview: false,
      }),
    ).toBe(false);
    expect(
      violatesSegregationOfDuties({
        actorId: "u1",
        preparedBy: "u1",
        requiresEvidence: true,
        allowSelfReview: true,
      }),
    ).toBe(false);
    expect(
      violatesSegregationOfDuties({
        actorId: "u1",
        preparedBy: "u1",
        requiresEvidence: false,
        allowSelfReview: false,
      }),
    ).toBe(false);
  });

  it("only allows legal item transitions", () => {
    expect(canTransitionItem("pending", "in_progress")).toBe(true);
    expect(canTransitionItem("completed", "pending")).toBe(false);
  });
});

describe("exception seeding", () => {
  const readiness = [
    { key: "draft_accruals", severity: "blocker" as const, count: 2, detail: { count: 2 } },
    { key: "missing_fx", severity: "warning" as const, count: 1, detail: { count: 1 } },
  ];

  it("fingerprints readiness checks deterministically", () => {
    expect(readinessFingerprint({ key: "draft_accruals" })).toBe(
      readinessFingerprint({ key: "draft_accruals" }),
    );
    expect(readinessFingerprint({ key: "draft_accruals" })).not.toBe(
      readinessFingerprint({ key: "missing_fx" }),
    );
  });

  it("produces one seed per readiness blocker with its severity", () => {
    const seeds = exceptionSeeds(readiness);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatchObject({ exception_type: "draft_accruals", severity: "blocker" });
    expect(seeds[1].severity).toBe("warning");
  });

  it("marks readiness exceptions stale when their check clears", () => {
    const rows = [
      exception({ id: "a", fingerprint: readinessFingerprint({ key: "draft_accruals" }) }),
      exception({ id: "b", fingerprint: readinessFingerprint({ key: "missing_fx" }) }),
      exception({ id: "manual", source: "manual", fingerprint: "manual:1" }),
    ];
    const stale = staleExceptionIds(rows, exceptionSeeds([readiness[0]]));
    expect(stale).toEqual(["b"]);
  });

  it("treats open and in-progress exceptions as unresolved", () => {
    expect(isExceptionOpen(exception({ status: "open" }))).toBe(true);
    expect(isExceptionOpen(exception({ status: "in_progress" }))).toBe(true);
    expect(isExceptionOpen(exception({ status: "resolved" }))).toBe(false);
    expect(isExceptionOpen(exception({ status: "accepted_risk" }))).toBe(false);
  });
});

describe("close gate", () => {
  const policy = CLOSE_POLICY_DEFAULTS;

  it("is ready when required items are done and no blocker exception is open", () => {
    const gate = closeGate({
      items: [item({ status: "completed" }), item({ status: "waived" })],
      exceptions: [exception({ status: "resolved" })],
      policy,
    });
    expect(gate.ready).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("blocks on incomplete required items, missing evidence and open blockers", () => {
    const gate = closeGate({
      items: [
        item({ status: "pending" }),
        item({ status: "completed", requires_evidence: true, evidence_count: 0 }),
      ],
      exceptions: [exception({ status: "open", severity: "blocker" })],
      policy,
      unexplainedMaterialMovements: 3,
    });
    expect(gate.ready).toBe(false);
    expect(gate.blockers.map((b) => b.key)).toEqual([
      "incomplete_required_items",
      "missing_evidence",
      "unresolved_blocker_exceptions",
      "unexplained_material_movement",
    ]);
    expect(gate.blockers.at(-1)!.count).toBe(3);
  });

  it("ignores optional items and accepted-risk exceptions", () => {
    const gate = closeGate({
      items: [item({ status: "pending", is_required: false })],
      exceptions: [exception({ status: "accepted_risk", severity: "blocker" })],
      policy,
    });
    expect(gate.ready).toBe(true);
  });

  it("blocks on open warnings only when the policy says so", () => {
    const exceptions = [exception({ status: "open", severity: "warning" })];
    expect(closeGate({ items: [], exceptions, policy }).ready).toBe(true);
    const strict = closeGate({
      items: [],
      exceptions,
      policy: { ...policy, block_on_warnings: true },
    });
    expect(strict.blockers.map((b) => b.key)).toEqual(["unresolved_warning_exceptions"]);
  });
});

describe("CSV exports", () => {
  const people = (id: string | null | undefined) => (id ? `Name ${id}` : "");

  it("writes a deterministic checklist CSV with a header row", () => {
    const csv = buildChecklistCsv(
      [item({ title: 'Book "vendor" invoices', assignee_id: "u1", status: "completed" })],
      people,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("seq");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Book ""vendor"" invoices"');
    expect(lines[1]).toContain("Name u1");
  });

  it("writes the exception register with severity and status", () => {
    const csv = buildExceptionsCsv([exception({ owner_id: "u9", status: "resolved" })], people);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("blocker");
    expect(lines[1]).toContain("resolved");
    expect(lines[1]).toContain("Name u9");
  });
});
