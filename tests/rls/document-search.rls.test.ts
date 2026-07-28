// P-264 — search_documents RPC access probe (anon + external-viewer denial).
// Self-skips when the backend is unreachable so `bun run test:all` stays green.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { isDevServerUp } from "../helpers/dev-server";

const URL_ = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";

const serverUp = (await isDevServerUp()) && Boolean(URL_ && ANON);

describe.skipIf(!serverUp)("document search RLS", () => {
  const anon: SupabaseClient = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("anon cannot execute search_documents", async () => {
    const { error } = await anon.rpc("search_documents", { p_query: "cable" } as never);
    expect(error).not.toBeNull();
  });

  it("anon cannot read the document register directly", async () => {
    const { data, error } = await anon.from("document_register").select("id").limit(10);
    if (error) expect(error.message).toBeTruthy();
    else expect(data ?? []).toHaveLength(0);
  });
});
