#!/usr/bin/env node
// P-250 — CI gate runner.
//
// Batch 32 doctrine: the derived-status harness and the RLS policy lint are
// MANDATORY, NAMED, NON-SKIPPABLE gates. They run after the full suite and
// print an unmistakable PASS/FAIL banner per gate. A gate that cannot run
// (missing DB env) is a FAILURE here, not a silent skip.

import { spawnSync } from "node:child_process";

const GATES = [
  {
    name: "GATE 1/2 · RLS POLICY LINT",
    file: "tests/rls/policy-lint.test.ts",
    why: "cross-tenant policy holes (0 flags required)",
  },
  {
    name: "GATE 2/2 · STATUS-CONSISTENCY HARNESS (13 classes)",
    file: "tests/integrity/status-consistency.test.ts",
    why: "derived-status divergences (0 required, real tenants by default)",
  },
];

const bar = (ch) => ch.repeat(72);

if (!process.env.PGHOST) {
  console.info(
    `\n${bar("=")}\nCI GATES: FAILED — no database connection (PGHOST unset).\nThe policy lint and status-consistency harness are non-skippable.\n${bar("=")}\n`,
  );
  process.exit(1);
}

let failed = 0;
for (const gate of GATES) {
  console.info(`\n${bar("=")}\n${gate.name}\n  ${gate.why}\n${bar("=")}`);
  const res = spawnSync(
    "bunx",
    ["vitest", "run", "--config", "vitest.config.all.ts", "--project", "all", gate.file],
    { stdio: "inherit", env: process.env },
  );
  const ok = res.status === 0;
  if (!ok) failed += 1;
  console.info(`\n>>> ${gate.name}: ${ok ? "PASS" : "FAIL"}\n`);
}

console.info(bar("="));
console.info(failed === 0 ? "CI GATES: ALL PASS" : `CI GATES: ${failed} GATE(S) FAILED`);
console.info(bar("="));
process.exit(failed === 0 ? 0 : 1);
