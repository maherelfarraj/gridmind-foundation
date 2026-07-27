// Regression: external portal viewers (vendor/client/investor/lender) must not
// be treated as internal company members. A vendor_viewer once inherited
// is_company_member() through profiles.company_id and could read every
// purchase_orders / vendors / expediting_logs row in the tenant directly
// through the data API, bypassing the vendor portal RPCs.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const files = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .sort();

function latestDefinition(fnName: string): string {
  let found = "";
  for (const name of files) {
    const body = readFileSync(join(MIGRATIONS, name), "utf8");
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$`,
      "gi",
    );
    const matches = [...body.matchAll(re)];
    if (matches.length) found = matches[matches.length - 1][0];
  }
  return found;
}

describe("external viewer isolation", () => {
  it("is_company_member excludes external portal viewers", () => {
    const def = latestDefinition("is_company_member");
    expect(def).not.toBe("");
    expect(def.toLowerCase()).toMatch(/not\s+public\.is_external_viewer\(\)/);
  });

  it("is_external_viewer covers every external portal role", () => {
    const def = latestDefinition("is_external_viewer").toLowerCase();
    for (const role of ["vendor_viewer", "client_viewer", "investor_viewer", "lender_viewer"]) {
      expect(def).toContain(role);
    }
  });
});
