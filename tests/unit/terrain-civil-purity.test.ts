// P-164 — Static purity guard: terrain/civil/geojson engines stay framework-free.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../src/lib");

function collect(target: string): string[] {
  const abs = path.join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => path.join(abs, f));
}

const FILES = [...collect("terrain"), ...collect("civil"), ...collect("geojson.ts")];

const FORBIDDEN = [
  /from\s+["']react["']/,
  /from\s+["']react-dom/,
  /from\s+["']@tanstack\//,
  /from\s+["']@supabase\//,
  /from\s+["']@\/integrations\/supabase/,
  /createServerFn/,
];

describe("terrain & civil engines are pure", () => {
  it("collects the engine modules", () => {
    expect(FILES.length).toBeGreaterThan(8);
  });

  it.each(FILES.map((f) => path.relative(ROOT, f)))("%s has no React/Supabase imports", (rel) => {
    const source = readFileSync(path.join(ROOT, rel), "utf8");
    for (const pattern of FORBIDDEN) {
      expect(pattern.test(source), `${rel} must not match ${pattern}`).toBe(false);
    }
  });
});
