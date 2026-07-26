// P-166 — Guard: the electrical calculator library must stay pure.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src/lib/electrical");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

const FORBIDDEN = [
  /^react$/,
  /^react[-/]/,
  /^@tanstack\//,
  /^@supabase\//,
  /integrations\/supabase/,
  /^@\/routes/,
  /\.server$/,
];

/** Every module specifier this file imports from. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

const DISCLAIMER =
  "Simplified engineering estimates — not validated against commercial analysis software; " +
  "qualified-engineer review required.";

describe("src/lib/electrical purity", () => {
  it("ships at least the five wave-1 calculators", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of FILES) {
    it(`${file} has no React/Supabase/route imports`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      for (const specifier of importSpecifiers(source)) {
        for (const pattern of FORBIDDEN) {
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(pattern);
        }
      }
      expect(source).not.toContain("createServerFn");
    });

    it(`${file} carries the honesty header comment`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source.startsWith(`// ${DISCLAIMER}`)).toBe(true);
    });
  }
});
