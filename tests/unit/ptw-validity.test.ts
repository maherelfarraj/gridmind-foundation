import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isPermitValid, permitDerivedStatus, type PermitRow } from "@/lib/construction/ptw";

const FROM = "2026-07-01T06:00:00.000Z";
const TO = "2026-07-01T18:00:00.000Z";

function permit(over: Partial<PermitRow> = {}): PermitRow {
  return {
    status: "active",
    valid_from: FROM,
    valid_to: TO,
    isolations_confirmed: true,
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("P-186 · PTW validity", () => {
  it("inside the window → valid", () => {
    expect(isPermitValid(permit(), at("2026-07-01T12:00:00.000Z"))).toBe(true);
  });

  it("exactly at valid_from → valid (inclusive start)", () => {
    expect(isPermitValid(permit(), at(FROM))).toBe(true);
  });

  it("exactly at valid_to → invalid (exclusive end)", () => {
    expect(isPermitValid(permit(), at(TO))).toBe(false);
  });

  it("before the window → invalid", () => {
    expect(isPermitValid(permit(), at("2026-07-01T05:59:59.000Z"))).toBe(false);
  });

  it.each(["suspended", "closed", "expired"] as const)(
    "%s inside the window → invalid",
    (status) => {
      expect(isPermitValid(permit({ status }), at("2026-07-01T12:00:00.000Z"))).toBe(false);
    },
  );

  it("unconfirmed isolations → invalid even inside the window", () => {
    expect(
      isPermitValid(permit({ isolations_confirmed: false }), at("2026-07-01T12:00:00.000Z")),
    ).toBe(false);
  });

  it("permitDerivedStatus: active row past valid_to derives 'expired' (lazy sweep)", () => {
    expect(permitDerivedStatus(permit(), at("2026-07-02T00:00:00.000Z"))).toBe("expired");
    expect(permitDerivedStatus(permit(), at("2026-07-01T12:00:00.000Z"))).toBe("active");
    expect(permitDerivedStatus(permit({ status: "closed" }), at("2026-07-02T00:00:00.000Z"))).toBe(
      "closed",
    );
  });
});

describe("P-186 · src/lib/construction purity", () => {
  it("has zero React / Supabase static imports", () => {
    const dir = join(process.cwd(), "src/lib/construction");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(dir, file), "utf8");
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/react|supabase|@tanstack/i);
      }
    }
  });
});
