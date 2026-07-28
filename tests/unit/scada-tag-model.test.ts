import { describe, expect, it } from "vitest";
import {
  applyScaling,
  buildAssetTree,
  classifyQuality,
  evaluateLimits,
  exceedsDeadband,
  flattenAssetTree,
  type TagDefinition,
} from "@/lib/scada/tag-model";

const tag: TagDefinition = {
  tag_key: "INV01.AC_P",
  unit: "kW",
  data_type: "analog",
  scale_factor: 0.1,
  scale_offset: -5,
  deadband: 2,
  sample_interval_s: 60,
  stale_after_s: 900,
  frozen_after_samples: 10,
  min_value: 0,
  max_value: 3000,
  warn_low: 50,
  warn_high: 2500,
  alarm_low: 10,
  alarm_high: 2900,
};

describe("scada tag model", () => {
  it("applies scaling and offset", () => {
    expect(applyScaling(1000, tag)).toBeCloseTo(95, 6);
  });

  it("honours deadband", () => {
    expect(exceedsDeadband(null, 10, 2)).toBe(true);
    expect(exceedsDeadband(10, 11, 2)).toBe(false);
    expect(exceedsDeadband(10, 13, 2)).toBe(true);
  });

  it("classifies quality", () => {
    expect(classifyQuality(tag, { value: 100, ageSeconds: 30 })).toBe("good");
    expect(classifyQuality(tag, { value: 100, ageSeconds: 400 })).toBe("suspect");
    expect(classifyQuality(tag, { value: 100, ageSeconds: 1000 })).toBe("bad");
    expect(classifyQuality(tag, { value: -1, ageSeconds: 10 })).toBe("bad");
    expect(classifyQuality(tag, { value: 100, ageSeconds: 10, repeatedSamples: 12 })).toBe(
      "suspect",
    );
  });

  it("evaluates limit bands with alarm precedence", () => {
    expect(evaluateLimits(tag, 500)).toBe("normal");
    expect(evaluateLimits(tag, 40)).toBe("warn_low");
    expect(evaluateLimits(tag, 2600)).toBe("warn_high");
    expect(evaluateLimits(tag, 5)).toBe("alarm_low");
    expect(evaluateLimits(tag, 2950)).toBe("alarm_high");
  });

  it("builds a sorted asset tree with paths", () => {
    const tree = buildAssetTree([
      { id: "b", asset_key: "BLK-01", name: "Block 1", parent_asset_id: "s", sort_order: 1 },
      { id: "s", asset_key: "SITE", name: "Site", parent_asset_id: null },
      { id: "i", asset_key: "INV-01", name: "Inv 1", parent_asset_id: "b" },
      { id: "o", asset_key: "ORPHAN", name: "Orphan", parent_asset_id: "missing" },
    ]);
    const flat = flattenAssetTree(tree);
    const site = flat.find((n) => n.id === "i");
    expect(site?.path).toBe("SITE/BLK-01/INV-01");
    expect(site?.depth).toBe(2);
    expect(flat.some((n) => n.id === "o" && n.depth === 0)).toBe(true);
  });
});
