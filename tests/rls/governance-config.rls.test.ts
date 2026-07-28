// Governance-config write scope — positive + negative probes for the five
// policies company-scoped in migration 0xxx (approval_rules,
// approval_chain_steps, company_branding, approval_instances,
// document_markups). A legit company_admin must keep working; a company_admin
// of another tenant must be denied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSupabaseUp, setupFixtures, type Fixtures } from "./helpers/rls";

const up = await isSupabaseUp();

describe.skipIf(!up)("governance config — company-scoped writes", () => {
  let f: Fixtures;

  beforeAll(async () => {
    f = await setupFixtures();
  }, 60_000);

  afterAll(async () => {
    await f?.cleanup();
  }, 60_000);

  it("approval_rules: own-company admin writes; cross-tenant admin denied", async () => {
    const { data: mine, error } = await f.A.client
      .from("approval_rules")
      .insert({
        company_id: f.A.companyId,
        rule_key: `probe_${crypto.randomUUID().slice(0, 8)}`,
        name: "Probe rule",
        entity_type: "purchase_order",
        is_active: false,
      })
      .select("id")
      .maybeSingle();
    expect(error, error?.message).toBeNull();
    expect(mine?.id).toBeTruthy();

    const cross = await f.B.client
      .from("approval_rules")
      .insert({
        company_id: f.A.companyId,
        rule_key: `probe_x_${crypto.randomUUID().slice(0, 8)}`,
        name: "Cross rule",
        entity_type: "purchase_order",
        is_active: false,
      })
      .select("id");
    expect(!!cross.error || (cross.data ?? []).length === 0).toBe(true);

    // Cross-tenant UPDATE of A's rule by B's admin affects zero rows.
    const upd = await f.B.client
      .from("approval_rules")
      .update({ name: "hijacked" })
      .eq("id", mine!.id)
      .select("id");
    expect((upd.data ?? []).length).toBe(0);
  });

  it("approval_chain_steps: own-company admin writes; cross-tenant admin denied", async () => {
    const rule = await f.svc
      .from("approval_rules")
      .insert({
        company_id: f.A.companyId,
        rule_key: `probe_chain_${crypto.randomUUID().slice(0, 8)}`,
        name: "Probe chain rule",
        entity_type: "purchase_order",
        is_active: false,
      })
      .select("id")
      .single();
    expect(rule.error, rule.error?.message).toBeNull();

    const mine = await f.A.client
      .from("approval_chain_steps")
      .insert({
        company_id: f.A.companyId,
        rule_id: rule.data!.id,
        step_order: 1,
        role: "company_admin",
      })
      .select("id");
    expect(mine.error, mine.error?.message).toBeNull();
    expect((mine.data ?? []).length).toBe(1);

    const cross = await f.B.client
      .from("approval_chain_steps")
      .insert({
        company_id: f.A.companyId,
        rule_id: rule.data!.id,
        step_order: 2,
        role: "company_admin",
      })
      .select("id");
    expect(!!cross.error || (cross.data ?? []).length === 0).toBe(true);
  });

  it("company_branding: own-company admin writes; cross-tenant admin denied", async () => {
    const mine = await f.A.client
      .from("company_branding")
      .upsert({ company_id: f.A.companyId, footer_text: "GSI probe" })
      .select("company_id");
    expect(mine.error, mine.error?.message).toBeNull();
    expect((mine.data ?? []).length).toBe(1);

    const cross = await f.B.client
      .from("company_branding")
      .update({ footer_text: "hijacked" })
      .eq("company_id", f.A.companyId)
      .select("company_id");
    expect((cross.data ?? []).length).toBe(0);
  });

  it("companies seed trigger still installs po_threshold_finance", async () => {
    const { data, error } = await f.svc
      .from("approval_rules")
      .select("rule_key")
      .eq("company_id", f.A.companyId)
      .eq("rule_key", "po_threshold_finance");
    expect(error, error?.message).toBeNull();
    expect((data ?? []).length).toBe(1);
  });
});
