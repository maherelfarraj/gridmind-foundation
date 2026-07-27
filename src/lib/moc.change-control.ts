// P-192 — Pure mirror of `is_under_change_control` plus banner presentation.
export const BLOCKING_STATUSES = ["assessment", "approved", "implementing"] as const;

export interface ChangeControlCr {
  id: string;
  cr_number: string;
  title: string;
  status: string;
  change_type?: string;
  company_id: string;
  affected_systems?: Array<{ entity_type?: string | null; entity_id?: string | null }> | null;
}

export interface ThreadLink {
  source_type: string;
  source_id: string;
  link_type: string;
  target_type: string;
  target_id: string;
}

export interface ChangeControlInput {
  /** Company of the caller. Null/undefined means unauthenticated → fail closed. */
  viewerCompanyId: string | null | undefined;
  entityType: string;
  entityId: string;
  changeRequests: ChangeControlCr[];
  links?: ThreadLink[];
}

function blocking(cr: ChangeControlCr): boolean {
  return (BLOCKING_STATUSES as readonly string[]).includes(cr.status);
}

/** Every open CR that freezes this entity, either directly or via the thread. */
export function blockingChanges(input: ChangeControlInput): ChangeControlCr[] {
  const { viewerCompanyId, entityType, entityId, changeRequests, links = [] } = input;
  if (!viewerCompanyId) return [];
  const scoped = changeRequests.filter((cr) => cr.company_id === viewerCompanyId && blocking(cr));

  const direct = scoped.filter((cr) =>
    (cr.affected_systems ?? []).some(
      (s) => s?.entity_type === entityType && s?.entity_id === entityId,
    ),
  );

  const impactedIds = new Set(
    links
      .filter(
        (l) =>
          l.source_type === "change_request" &&
          l.link_type === "impacts" &&
          l.target_type === entityType &&
          l.target_id === entityId,
      )
      .map((l) => l.source_id),
  );
  const viaThread = scoped.filter((cr) => impactedIds.has(cr.id));

  const out = new Map<string, ChangeControlCr>();
  for (const cr of [...direct, ...viaThread]) out.set(cr.id, cr);
  return Array.from(out.values());
}

/** Fails closed: an unauthenticated caller is always treated as blocked. */
export function isUnderChangeControl(input: ChangeControlInput): boolean {
  if (!input.viewerCompanyId) return true;
  return blockingChanges(input).length > 0;
}

export interface BannerState {
  visible: boolean;
  /** Token-only amber treatment — never a raw colour. */
  toneClass: string;
  headline: string;
  crNumbers: string[];
  issuePoDisabled: boolean;
  tooltip?: string;
}

export function bannerState(
  changes: Array<{ cr_number: string; status: string }>,
  blocked = changes.length > 0,
): BannerState {
  const first = changes[0];
  return {
    visible: blocked,
    toneClass: "bg-accent/15 text-accent",
    headline: `Under change control${first ? ` — ${first.cr_number} ${first.status}` : ""}`,
    crNumbers: changes.map((c) => c.cr_number),
    issuePoDisabled: blocked,
    tooltip: blocked
      ? "Blocked: an open change request freezes this record until implementation closes."
      : undefined,
  };
}
