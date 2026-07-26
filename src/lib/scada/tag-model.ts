/**
 * P-171 — SCADA asset hierarchy + tag dictionary helpers.
 * Pure functions only: no React, no Supabase imports.
 */

export type TagDataType = "analog" | "digital" | "counter" | "string" | "enum";
export type TagSourceSystem =
  | "manual"
  | "mqtt"
  | "opcua"
  | "modbus"
  | "historian_csv"
  | "api";

export type TagQuality = "good" | "suspect" | "bad";

export interface TagDefinition {
  tag_key: string;
  unit: string;
  data_type: TagDataType;
  scale_factor: number;
  scale_offset: number;
  deadband: number;
  sample_interval_s: number;
  stale_after_s: number;
  frozen_after_samples: number;
  min_value?: number | null;
  max_value?: number | null;
  warn_low?: number | null;
  warn_high?: number | null;
  alarm_low?: number | null;
  alarm_high?: number | null;
}

/** Convert a raw source value to engineering units. */
export function applyScaling(raw: number, tag: Pick<TagDefinition, "scale_factor" | "scale_offset">): number {
  return raw * tag.scale_factor + tag.scale_offset;
}

/** True when a new value moves more than the configured deadband. */
export function exceedsDeadband(previous: number | null | undefined, next: number, deadband: number): boolean {
  if (previous === null || previous === undefined) return true;
  return Math.abs(next - previous) > deadband;
}

export interface QualityInput {
  value: number;
  ageSeconds: number;
  repeatedSamples?: number;
}

/** Classify a reading against staleness, frozen-value and range rules. */
export function classifyQuality(tag: TagDefinition, input: QualityInput): TagQuality {
  if (!Number.isFinite(input.value)) return "bad";
  if (input.ageSeconds > tag.stale_after_s) return "bad";
  if (tag.min_value != null && input.value < tag.min_value) return "bad";
  if (tag.max_value != null && input.value > tag.max_value) return "bad";
  if ((input.repeatedSamples ?? 0) >= tag.frozen_after_samples) return "suspect";
  if (input.ageSeconds > tag.sample_interval_s * 3) return "suspect";
  return "good";
}

export type LimitBand = "normal" | "warn_low" | "warn_high" | "alarm_low" | "alarm_high";

/** Which operating band a value falls into. Alarm bands win over warning bands. */
export function evaluateLimits(tag: TagDefinition, value: number): LimitBand {
  if (tag.alarm_low != null && value <= tag.alarm_low) return "alarm_low";
  if (tag.alarm_high != null && value >= tag.alarm_high) return "alarm_high";
  if (tag.warn_low != null && value <= tag.warn_low) return "warn_low";
  if (tag.warn_high != null && value >= tag.warn_high) return "warn_high";
  return "normal";
}

export interface AssetNodeInput {
  id: string;
  asset_key: string;
  name: string;
  parent_asset_id?: string | null;
  sort_order?: number | null;
}

export interface AssetTreeNode extends AssetNodeInput {
  depth: number;
  path: string;
  children: AssetTreeNode[];
}

/** Build a depth-annotated tree; orphaned nodes are treated as roots. */
export function buildAssetTree(assets: AssetNodeInput[]): AssetTreeNode[] {
  const byId = new Map<string, AssetTreeNode>();
  for (const a of assets) {
    byId.set(a.id, { ...a, depth: 0, path: a.asset_key, children: [] });
  }
  const roots: AssetTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_asset_id ? byId.get(node.parent_asset_id) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortFn = (a: AssetTreeNode, b: AssetTreeNode) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.asset_key.localeCompare(b.asset_key);

  const walk = (nodes: AssetTreeNode[], depth: number, prefix: string) => {
    nodes.sort(sortFn);
    for (const n of nodes) {
      n.depth = depth;
      n.path = prefix ? `${prefix}/${n.asset_key}` : n.asset_key;
      walk(n.children, depth + 1, n.path);
    }
  };
  walk(roots, 0, "");
  return roots;
}

/** Flatten a tree in display order. */
export function flattenAssetTree(nodes: AssetTreeNode[]): AssetTreeNode[] {
  const out: AssetTreeNode[] = [];
  const walk = (list: AssetTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
