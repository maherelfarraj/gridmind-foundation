// P-226 — Offline policy store for the vendor portal tables.
//
// Grants and policies are parsed straight out of the shipped migrations (same
// spirit as tests/rls/bonds.test.ts) and replayed in memory, so "who can do
// what" is asserted executably without a live database.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

export const VENDOR_PORTAL_SQL = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .sort()
  .map((n) => readFileSync(join(MIGRATIONS, n), "utf8"))
  .filter((body) => body.includes("vendor_portal_"))
  .join("\n");

export type Action = "select" | "insert" | "update" | "delete";
export const ACTIONS: Action[] = ["select", "insert", "update", "delete"];

export interface Actor {
  userId: string;
  companyId: string | null;
  roles: readonly string[];
  external?: boolean;
  /** Postgres role — only `authenticated` is subject to RLS here. */
  dbRole?: "authenticated" | "anon" | "service_role";
}

export interface PolicyRow {
  company_id?: string | null;
  user_id?: string | null;
  [k: string]: unknown;
}

interface ParsedPolicy {
  action: Action | "all";
  ownRow: boolean;
  memberScoped: boolean;
  notExternal: boolean;
  denyAll: boolean;
  roles: string[];
}

/** Replay grant/revoke statements in file order for one table + grantee. */
function grantedActions(table: string, grantee: string): Set<Action> {
  const set = new Set<Action>();
  const re = new RegExp(
    `(grant|revoke)\\s+([\\w,\\s]+?)\\s+(?:on)\\s+public\\.${table}\\s+(?:to|from)\\s+([\\w,\\s]+?);`,
    "gi",
  );
  for (const m of VENDOR_PORTAL_SQL.matchAll(re)) {
    const kind = m[1].toLowerCase();
    const grantees = m[3].split(",").map((s) => s.trim().toLowerCase());
    if (!grantees.includes(grantee)) continue;
    const privs = m[2].split(",").map((s) => s.trim().toLowerCase());
    const expanded = privs.includes("all") ? ACTIONS : (privs as Action[]);
    for (const p of expanded) {
      if (!ACTIONS.includes(p)) continue;
      if (kind === "grant") set.add(p);
      else set.delete(p);
    }
  }
  return set;
}

function parsePolicies(table: string): ParsedPolicy[] {
  const re = new RegExp(
    `create policy\\s+"?\\w+"?\\s+on\\s+public\\.${table}\\s+for\\s+(select|insert|update|delete|all)[\\s\\S]*?;`,
    "gi",
  );
  return [...VENDOR_PORTAL_SQL.matchAll(re)].map((m) => {
    const body = m[0];
    return {
      action: m[1].toLowerCase() as Action | "all",
      ownRow: /user_id\s*=\s*auth\.uid\(\)/i.test(body),
      memberScoped: /is_company_member\(company_id\)/i.test(body),
      notExternal: /not\s+public\.is_external_viewer\(\)/i.test(body),
      denyAll: /(with check|using)\s*\(\s*false\s*\)/i.test(body),
      roles: [...body.matchAll(/has_company_role\('(\w+)'/g)].map((r) => r[1]),
    };
  });
}

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: "no_grant" | "no_policy" | "policy_denied" };

export interface TableAcl {
  table: string;
  grants: Set<Action>;
  policies: ParsedPolicy[];
  can: (actor: Actor, action: Action, row?: PolicyRow) => Verdict;
  /** Rows an actor can actually SELECT out of a fixture set. */
  visible: <T extends PolicyRow>(actor: Actor, rows: readonly T[]) => T[];
}

function evaluate(policy: ParsedPolicy, actor: Actor, row: PolicyRow): boolean {
  if (policy.ownRow && row.user_id && row.user_id === actor.userId) return true;
  if (policy.memberScoped && row.company_id !== actor.companyId) return false;
  if (policy.notExternal && actor.external) return false;
  if (policy.roles.length > 0 && !policy.roles.some((r) => actor.roles.includes(r))) return false;
  // A pure own-row policy with no other clause must match the own-row branch.
  if (policy.ownRow && !policy.memberScoped && !policy.roles.length) return false;
  return policy.memberScoped || policy.roles.length > 0;
}

export function tableAcl(table: string): TableAcl {
  const grants = grantedActions(table, "authenticated");
  const policies = parsePolicies(table);

  const can = (actor: Actor, action: Action, row: PolicyRow = {}): Verdict => {
    if ((actor.dbRole ?? "authenticated") === "service_role") return { allowed: true };
    if (!grants.has(action)) return { allowed: false, reason: "no_grant" };
    const applicable = policies.filter((p) => p.action === action || p.action === "all");
    if (applicable.length === 0) return { allowed: false, reason: "no_policy" };
    return applicable.some((p) => evaluate(p, actor, row))
      ? { allowed: true }
      : { allowed: false, reason: "policy_denied" };
  };

  return {
    table,
    grants,
    policies,
    can,
    visible: (actor, rows) => rows.filter((r) => can(actor, "select", r).allowed),
  };
}

export const membershipsAcl = tableAcl("vendor_portal_memberships");
export const eventsAcl = tableAcl("vendor_portal_events");
