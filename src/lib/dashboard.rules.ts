// POL-2 — Pure helpers for the dashboard: activity humanization + relative time.

export interface RawActivityRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  /** P-240 — stable key for `activity.actions.<key>` lookups (English fallback via `action`). */
  actionKey: string;
  entity: string;
  /** P-240 — raw table name for `activity.entities.<key>` lookups. */
  entityKey: string;
  when: string;
  created_at: string;
}

/** "vendor_portal.delivery_proposed" -> "delivery_proposed" */
export function actionKeyOf(action: string): string {
  const tail = action.includes(".") ? action.slice(action.lastIndexOf(".") + 1) : action;
  return tail.replace(/[\s-]+/g, "_").trim().toLowerCase();
}

/** "vendor_portal.delivery_proposed" -> "Delivery proposed" */
export function humanizeAction(action: string): string {
  const tail = action.includes(".") ? action.slice(action.lastIndexOf(".") + 1) : action;
  const words = tail.replace(/[_-]+/g, " ").trim();
  if (!words) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}


/** "purchase_orders" -> "Purchase order" (naive singularization, good enough for labels). */
export function humanizeEntity(entity: string): string {
  const words = entity.replace(/[_-]+/g, " ").trim();
  if (!words) return entity;
  const singular = words.endsWith("ies")
    ? `${words.slice(0, -3)}y`
    : words.endsWith("ss")
      ? words
      : words.endsWith("s")
        ? words.slice(0, -1)
        : words;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function toActivityItem(row: RawActivityRow, now: Date = new Date()): ActivityItem {
  return {
    id: row.id,
    actor: row.actor_name?.trim() || "System",
    action: humanizeAction(row.action),
    actionKey: actionKeyOf(row.action),
    entity: humanizeEntity(row.entity),
    entityKey: row.entity,

    when: relativeTime(row.created_at, now),
    created_at: row.created_at,
  };
}
