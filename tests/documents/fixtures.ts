// P-268 — Batch 35 finale: document-control fixture tenant.
//
// TWO throw-away tenants (a home tenant and a foreign one) plus five seats
// covering every authorization class the document module distinguishes:
//
//   admin        company_admin      — full control, deletes, dossiers
//   engineer     engineering_admin  — issues and recalls controlled copies
//   procurement  procurement_admin  — registers documents, NOT copies
//   viewer       client_viewer      — external viewer, denied everywhere
//   otherAdmin   company_admin (B)  — cross-tenant probe
//
// Teardown goes through `fixture_purge_tenants` (Batch 32 doctrine), so the
// company count returns to the two protected tenants after the run.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";
import {
  anonClient,
  createUser as createUserOnce,
  isSupabaseUp,
  serviceClient,
} from "../portfolio/fixtures";

export { anonClient, isSupabaseUp, serviceClient };

export type Svc = SupabaseClient<Database>;
type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: null | { message: string; code?: string } }>;

export const rpc = (client: Svc): Rpc => (client.rpc as unknown as Rpc).bind(client) as Rpc;

/** Sign-ups are rate-limited when the whole suite runs; back off and retry. */
export async function createUser(
  svc: Svc,
  prefix: string,
): Promise<Awaited<ReturnType<typeof createUserOnce>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await createUserOnce(svc, prefix);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function insertOne<T extends { id: string }>(
  svc: Svc,
  table: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await svc
    .from(table as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`${table}: ${error?.message}`);
  return data as T;
}

async function createTenant(svc: Svc, label: string): Promise<string> {
  const { id } = await insertOne<{ id: string }>(svc, "companies", {
    name: `P268 ${label}`,
    slug: `p268-${label}-${crypto.randomUUID().slice(0, 8)}`,
    plan_tier: "enterprise",
  });
  return id;
}

async function attachMember(
  svc: Svc,
  userId: string,
  email: string,
  companyId: string,
  roles: ReadonlyArray<Database["public"]["Enums"]["app_role"]>,
): Promise<void> {
  const { error: pErr } = await svc
    .from("profiles")
    .upsert({ id: userId, company_id: companyId, email });
  if (pErr) throw pErr;
  if (roles.length === 0) return;
  const { error: rErr } = await svc
    .from("user_roles")
    .insert(roles.map((role) => ({ user_id: userId, company_id: companyId, role })));
  if (rErr) throw rErr;
}

export interface Seat {
  userId: string;
  email: string;
  client: Svc;
}

export interface DocumentFixture {
  svc: Svc;
  companyId: string;
  projectId: string;
  /** Unique token embedded in every fixture title — search corpus anchor. */
  token: string;
  admin: Seat;
  engineer: Seat;
  procurement: Seat;
  viewer: Seat;
  other: Seat & { companyId: string };
  cleanup: () => Promise<void>;
}

export async function setupDocumentFixture(): Promise<DocumentFixture> {
  const svc = serviceClient();
  const tenants: string[] = [];
  const users: string[] = [];
  const cleanup = async () => {
    await purgeFixtureTenants(svc, tenants);
    await deleteFixtureUsers(svc, users);
  };

  try {
    const companyId = await createTenant(svc, "docs");
    tenants.push(companyId);
    const otherCompanyId = await createTenant(svc, "other");
    tenants.push(otherCompanyId);

    const seat = async (
      prefix: string,
      company: string,
      roles: ReadonlyArray<Database["public"]["Enums"]["app_role"]>,
    ): Promise<Seat> => {
      const user = await createUser(svc, prefix);
      users.push(user.userId);
      await attachMember(svc, user.userId, user.email, company, roles);
      return { userId: user.userId, email: user.email, client: user.client };
    };

    const admin = await seat("p268-admin", companyId, ["company_admin"]);
    const engineer = await seat("p268-eng", companyId, ["engineering_admin"]);
    const procurement = await seat("p268-proc", companyId, ["procurement_admin"]);
    const viewer = await seat("p268-viewer", companyId, ["client_viewer"]);
    const otherSeat = await seat("p268-other", otherCompanyId, ["company_admin"]);

    const token = `zylotrench${crypto.randomUUID().slice(0, 6).toLowerCase()}`;
    const project = await insertOne<{ id: string }>(svc, "projects", {
      company_id: companyId,
      code: `P268-${token.slice(-6).toUpperCase()}`,
      name: `P268 document control ${token}`,
      archetype: "utility_pv",
      phase: "ntp",
      status: "active",
      created_by: admin.userId,
    });

    return {
      svc,
      companyId,
      projectId: project.id,
      token,
      admin,
      engineer,
      procurement,
      viewer,
      other: { ...otherSeat, companyId: otherCompanyId },
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hand-computed expectations (see lifecycle.test.ts for the narrative)
// ---------------------------------------------------------------------------
export const EXPECTED = {
  /** Three-deep supersedure chain, oldest first. */
  chain: ["A", "B", "C"],
  /** Copies are numbered per document, starting at 1. */
  copyNumbers: [1, 2, 3],
  /** total / outstanding / closed after one 'returned' disposition. */
  completenessAfterReturn: { total: 3, outstanding: 2, closed: 1, recallDue: 0 },
  /** Superseding the document flags every OUTSTANDING copy as recall-due. */
  recallDueAfterSupersede: 2,
  /** transient = 90 days from the retention anchor. */
  transientDays: 90,
} as const;
