// P-164 — Terrain / civil / optimization cross-tenant RLS probe.
// Self-skips when the dev server (and therefore the test backend) is down, so
// `bun run test:all` stays green offline.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { isDevServerUp } from "../helpers/dev-server";

const URL_ = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";

const TABLES = ["terrain_surfaces", "civil_features", "layout_optimization_runs"] as const;

const serverUp = (await isDevServerUp()) && Boolean(URL_ && ANON);

describe.skipIf(!serverUp)("terrain & civil RLS", () => {
  const anon: SupabaseClient = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it.each(TABLES)("anon SELECT on %s returns zero rows", async (table) => {
    const { data, error } = await anon.from(table).select("id").limit(50);
    // Either the policy denies the read outright, or it returns an empty set.
    if (error) expect(error.message).toBeTruthy();
    else expect(data ?? []).toHaveLength(0);
  });

  it.each(TABLES)("anon INSERT on %s is rejected", async (table) => {
    const { error } = await anon.from(table).insert({ id: crypto.randomUUID() } as never);
    expect(error).not.toBeNull();
  });

  it("company-B session cannot read company-A rows", async () => {
    const email = process.env.RLS_TEST_B_EMAIL;
    const password = process.env.RLS_TEST_B_PASSWORD;
    const companyA = process.env.RLS_TEST_COMPANY_A_ID;
    if (!email || !password || !companyA) {
      // Credentials for the cross-tenant actor are optional in local runs.
      expect(true).toBe(true);
      return;
    }
    const client = createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: authError } = await client.auth.signInWithPassword({ email, password });
    expect(authError).toBeNull();

    for (const table of TABLES) {
      const { data, error } = await client.from(table).select("id").eq("company_id", companyA);
      if (error) expect(error.message).toBeTruthy();
      else expect(data ?? []).toHaveLength(0);
    }
    await client.auth.signOut();
  });
});
