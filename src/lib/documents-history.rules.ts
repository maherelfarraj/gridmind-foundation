// P-265 — Pure rules for supersedure chains and revision comparison.
//
// Doctrine: the supersedure chain is *derived* — the database maintains
// `superseded_by_id` when a new revision is registered. These helpers only
// interpret what the chain RPCs return; they never guess at status.

export interface LineageNode {
  id: string;
  doc_number: string | null;
  title: string;
  current_revision: string;
  status: string;
  discipline: string | null;
  change_summary: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  depth: number;
  is_root: boolean;
}

/** Oldest → newest. The RPC already orders, but the UI must not depend on it. */
export function orderLineage(nodes: LineageNode[]): LineageNode[] {
  return [...nodes].sort(
    (a, b) => a.depth - b.depth || Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}

/** The live revision: the only node nothing supersedes. */
export function currentNode(nodes: LineageNode[]): LineageNode | null {
  const ordered = orderLineage(nodes);
  return ordered.find((n) => n.superseded_by_id === null) ?? ordered.at(-1) ?? null;
}

export function isHistorical(node: LineageNode | null | undefined): boolean {
  return Boolean(node && node.superseded_by_id !== null);
}

export type LineageTone = "current" | "superseded" | "obsolete" | "draft";

export function lineageTone(node: LineageNode): LineageTone {
  if (node.status === "obsolete") return "obsolete";
  if (node.status === "superseded" || node.superseded_by_id !== null) return "superseded";
  if (node.status === "draft") return "draft";
  return "current";
}

/** Visual compare only makes sense for rendered files. */
const VISUAL_MIME = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif|svg\+xml))$/i;

export function isVisuallyComparable(mimeA?: string | null, mimeB?: string | null): boolean {
  return VISUAL_MIME.test(mimeA ?? "") && VISUAL_MIME.test(mimeB ?? "");
}

export interface FieldDiff {
  field: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

export const DIFF_FIELDS = [
  "title",
  "current_revision",
  "status",
  "discipline",
  "owner_name",
  "change_summary",
  "created_at",
] as const;

export type DiffField = (typeof DIFF_FIELDS)[number];

/** Field-level diff between two lineage nodes, oldest arg first. */
export function diffRevisions(a: LineageNode, b: LineageNode): FieldDiff[] {
  return DIFF_FIELDS.map((field) => {
    const before = normalise(a[field]);
    const after = normalise(b[field]);
    return { field, before, after, changed: before !== after };
  });
}

export function changedOnly(diffs: FieldDiff[]): FieldDiff[] {
  return diffs.filter((d) => d.changed);
}

function normalise(value: string | null | undefined): string | null {
  const s = (value ?? "").trim();
  return s === "" ? null : s;
}

/** A new revision must explain itself — mirrored by a database check. */
export const CHANGE_SUMMARY_MIN = 8;

export function isValidChangeSummary(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().length >= CHANGE_SUMMARY_MIN;
}
