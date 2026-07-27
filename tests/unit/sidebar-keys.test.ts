// Day 7 rider — sidebar React key uniqueness guard.
// Duplicate keys were the source of the "Encountered two children with the same
// key" warning; nav keys are now `group.key + url + label`, which must be unique.
import { describe, expect, it } from "vitest";

import { NAV_GROUPS } from "@/lib/nav-map";

describe("sidebar nav keys", () => {
  it("has unique group keys", () => {
    const keys = NAV_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique group+url+label keys for every item", () => {
    const keys = NAV_GROUPS.flatMap((g) =>
      (g.items ?? []).map((i) => `${g.key}:${i.url}:${i.label}`),
    );
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});
