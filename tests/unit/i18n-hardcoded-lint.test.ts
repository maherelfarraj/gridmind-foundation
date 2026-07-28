// P-244 — repo-wide hardcoded-string lint.
//
// Fails when any user-facing raw string appears as JSX children in
// src/routes or src/components, except for the explicit exemptions in
// i18n-lint.config.ts and the recorded pre-Batch-31 baseline. The baseline is
// a ratchet: files may only get cleaner, never dirtier, and a file that has
// been fully cleaned must be removed from the list.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

import baseline from "./i18n-lint.baseline.json";
import { FILE_EXEMPTIONS, extractRawStrings } from "./i18n-lint.config";

const ROOT = process.cwd();
const exemptFiles = new Set(FILE_EXEMPTIONS.map((e) => e.file));
const baselineCounts = baseline as Record<string, number>;

function scan() {
  const files = globSync(["src/routes/**/*.tsx", "src/components/**/*.tsx"], { cwd: ROOT }).sort();
  const counts = new Map<string, string[]>();
  for (const file of files) {
    if (exemptFiles.has(file)) continue;
    const hits = extractRawStrings(readFileSync(resolve(ROOT, file), "utf8"));
    if (hits.length) counts.set(file, hits);
  }
  return counts;
}

describe("hardcoded user-facing strings (repo-wide)", () => {
  const found = scan();

  it("has no raw JSX strings outside the recorded baseline", () => {
    const offenders = [...found.entries()]
      .filter(([file]) => baselineCounts[file] === undefined)
      .map(([file, hits]) => `${file}: ${hits.slice(0, 6).join(" | ")}`);
    expect(offenders, `newly hardcoded strings:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never lets a baseline file regress", () => {
    const regressions = [...found.entries()]
      .filter(([file, hits]) => hits.length > (baselineCounts[file] ?? 0))
      .map(([file, hits]) => `${file}: ${hits.length} > baseline ${baselineCounts[file]}`);
    expect(regressions, `baseline regressions:\n${regressions.join("\n")}`).toEqual([]);
  });

  it("keeps the baseline honest — cleaned files must be delisted", () => {
    const stale = Object.keys(baselineCounts).filter((file) => !found.has(file));
    expect(
      stale,
      `these files are clean now, remove them from the baseline:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("documents every exemption with a reason", () => {
    for (const e of FILE_EXEMPTIONS) expect(e.reason.length).toBeGreaterThan(4);
  });
});
