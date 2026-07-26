// P-141 — Pure, deterministic tagging engine for SLD drawings.
// No React / Supabase imports: this module must stay unit-testable in isolation.

export const TAG_PATTERN = /^[A-Z]{2,6}-\d{2}-\d{2}$/;
export const CABLE_PREFIX = "CBL";
export const DEFAULT_AREA_CODE = "01";

/** Connection types that never receive a cable number. */
export const UNTAGGED_CONNECTION_TYPES = ["earth", "signal"] as const;

export type TagAreaBounds = { x: number; y: number; w: number; h: number };

/** Persisted on sld_revisions.canvas as `areas`. */
export type TagArea = {
  id: string;
  name: string;
  bounds: TagAreaBounds;
  /** Optional explicit 2-digit code; otherwise derived from position in the list. */
  code?: string;
};

export type TaggableObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  x: number;
  y: number;
};

export type TaggableConnection = {
  id: string;
  connection_type: string;
  cable_number: string | null;
  from_object_id: string;
  to_object_id: string;
};

export type SymbolPrefixSource = { type_key: string; tag_prefix: string };

export type TagAssignment = {
  id: string;
  previous: string | null;
  tag: string;
};

export type CableAssignment = {
  id: string;
  previous: string | null;
  cable_number: string;
};

export type DuplicateTagGroup = {
  tag: string;
  ids: string[];
  /** Ids that should be renumbered by auto-resolve (everything after the first). */
  offenderIds: string[];
};

export function isValidTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}

export function padSeq(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

/** Normalizes an arbitrary area identifier into a 2-digit code. */
export function areaCode(area: TagArea | undefined, index: number): string {
  const raw = area?.code ?? (area && /^\d+$/.test(area.id) ? area.id : undefined);
  if (raw && /^\d+$/.test(raw)) return padSeq(Number(raw));
  if (!area) return DEFAULT_AREA_CODE;
  return padSeq(index + 1);
}

function inBounds(point: { x: number; y: number }, b: TagAreaBounds): boolean {
  return point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h;
}

/** Area code an object falls into; `01` when it matches no defined area. */
export function areaForPoint(point: { x: number; y: number }, areas: TagArea[] = []): string {
  for (let i = 0; i < areas.length; i += 1) {
    const area = areas[i];
    if (area?.bounds && inBounds(point, area.bounds)) return areaCode(area, i);
  }
  return DEFAULT_AREA_CODE;
}

export function prefixFor(
  symbolType: string,
  symbolTypes: SymbolPrefixSource[] = [],
): string | null {
  const record = symbolTypes.find((s) => s.type_key === symbolType);
  const prefix = record?.tag_prefix?.trim().toUpperCase();
  if (!prefix) return null;
  return /^[A-Z]{2,6}$/.test(prefix) ? prefix : null;
}

export function parseTag(tag: string | null): { prefix: string; area: string; seq: number } | null {
  if (!tag || !TAG_PATTERN.test(tag)) return null;
  const [prefix, area, seq] = tag.split("-");
  return { prefix, area, seq: Number(seq) };
}

function bucketKey(prefix: string, area: string): string {
  return `${area}|${prefix}`;
}

/**
 * Deterministic tag assignment.
 * Candidates are sorted by (area, prefix, y, x) and numbered sequentially, so
 * re-running over an unchanged graph produces identical output.
 * Without `force`, already-tagged objects keep their tag and reserve its number.
 */
export function generateTags(
  objects: TaggableObject[],
  symbolTypes: SymbolPrefixSource[],
  areas: TagArea[] = [],
  options: { force?: boolean } = {},
): TagAssignment[] {
  const force = options.force === true;

  const candidates = objects
    .map((o) => ({
      obj: o,
      prefix: prefixFor(o.symbol_type, symbolTypes),
      area: areaForPoint(o, areas),
    }))
    .filter((c): c is { obj: TaggableObject; prefix: string; area: string } => c.prefix !== null)
    .sort(
      (a, b) =>
        a.area.localeCompare(b.area) ||
        a.prefix.localeCompare(b.prefix) ||
        a.obj.y - b.obj.y ||
        a.obj.x - b.obj.x ||
        a.obj.id.localeCompare(b.obj.id),
    );

  // Reserve sequence numbers held by tags we are keeping.
  const used = new Map<string, Set<number>>();
  const reserve = (prefix: string, area: string, seq: number) => {
    const key = bucketKey(prefix, area);
    const set = used.get(key) ?? new Set<number>();
    set.add(seq);
    used.set(key, set);
  };
  const nextFree = (prefix: string, area: string): number => {
    const set = used.get(bucketKey(prefix, area)) ?? new Set<number>();
    let n = 1;
    while (set.has(n)) n += 1;
    reserve(prefix, area, n);
    return n;
  };

  const keepIds = new Set<string>();
  if (!force) {
    const seenTags = new Set<string>();
    for (const c of candidates) {
      const parsed = parseTag(c.obj.tag);
      // Only honour a tag that is well-formed and not a duplicate of one already kept.
      if (!parsed || seenTags.has(c.obj.tag as string)) continue;
      seenTags.add(c.obj.tag as string);
      keepIds.add(c.obj.id);
      reserve(parsed.prefix, parsed.area, parsed.seq);
    }
  }

  const assignments: TagAssignment[] = [];
  for (const c of candidates) {
    if (keepIds.has(c.obj.id)) continue;
    const tag = `${c.prefix}-${c.area}-${padSeq(nextFree(c.prefix, c.area))}`;
    if (tag !== c.obj.tag) assignments.push({ id: c.obj.id, previous: c.obj.tag, tag });
  }
  return assignments;
}

/** CBL-{AREA}-{SEQ} for cable/dc_string/busbar links; earth + signal are skipped. */
export function generateCableNumbers(
  connections: TaggableConnection[],
  objects: TaggableObject[] = [],
  areas: TagArea[] = [],
  options: { force?: boolean } = {},
): CableAssignment[] {
  const force = options.force === true;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const skip = new Set<string>(UNTAGGED_CONNECTION_TYPES);

  const candidates = connections
    .filter((c) => !skip.has(c.connection_type))
    .map((c) => {
      const from = byId.get(c.from_object_id);
      const anchor = from ?? byId.get(c.to_object_id);
      return {
        conn: c,
        area: anchor ? areaForPoint(anchor, areas) : DEFAULT_AREA_CODE,
        y: anchor?.y ?? 0,
        x: anchor?.x ?? 0,
      };
    })
    .sort(
      (a, b) =>
        a.area.localeCompare(b.area) ||
        a.y - b.y ||
        a.x - b.x ||
        a.conn.id.localeCompare(b.conn.id),
    );

  const used = new Map<string, Set<number>>();
  const reserve = (area: string, seq: number) => {
    const set = used.get(area) ?? new Set<number>();
    set.add(seq);
    used.set(area, set);
  };
  const nextFree = (area: string): number => {
    const set = used.get(area) ?? new Set<number>();
    let n = 1;
    while (set.has(n)) n += 1;
    reserve(area, n);
    return n;
  };

  const keepIds = new Set<string>();
  if (!force) {
    const seen = new Set<string>();
    for (const c of candidates) {
      const parsed = parseTag(c.conn.cable_number);
      if (!parsed || parsed.prefix !== CABLE_PREFIX) continue;
      if (seen.has(c.conn.cable_number as string)) continue;
      seen.add(c.conn.cable_number as string);
      keepIds.add(c.conn.id);
      reserve(parsed.area, parsed.seq);
    }
  }

  const assignments: CableAssignment[] = [];
  for (const c of candidates) {
    if (keepIds.has(c.conn.id)) continue;
    const number = `${CABLE_PREFIX}-${c.area}-${padSeq(nextFree(c.area))}`;
    if (number !== c.conn.cable_number) {
      assignments.push({ id: c.conn.id, previous: c.conn.cable_number, cable_number: number });
    }
  }
  return assignments;
}

/** Collisions on identical non-empty tags, in stable canvas order. */
export function findDuplicateTags(objects: TaggableObject[]): DuplicateTagGroup[] {
  const groups = new Map<string, string[]>();
  for (const o of objects) {
    const tag = o.tag?.trim();
    if (!tag) continue;
    const list = groups.get(tag) ?? [];
    list.push(o.id);
    groups.set(tag, list);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([tag, ids]) => ({ tag, ids, offenderIds: ids.slice(1) }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Ids carrying a duplicated tag — for inline red badges. */
export function duplicateTagIds(objects: TaggableObject[]): Set<string> {
  return new Set(findDuplicateTags(objects).flatMap((g) => g.ids));
}

/**
 * Renumbers only the later members of each duplicate group, leaving every
 * uniquely-tagged object untouched.
 */
export function autoResolveDuplicates(
  objects: TaggableObject[],
  symbolTypes: SymbolPrefixSource[],
  areas: TagArea[] = [],
): TagAssignment[] {
  const offenders = new Set(findDuplicateTags(objects).flatMap((g) => g.offenderIds));
  if (offenders.size === 0) return [];
  const cleared = objects.map((o) => (offenders.has(o.id) ? { ...o, tag: null } : o));
  return generateTags(cleared, symbolTypes, areas).filter((a) => offenders.has(a.id));
}

export type RetagPlan = {
  tags: TagAssignment[];
  cables: CableAssignment[];
};

/** Full retag plan — the same computation the server applies. */
export function planRetag(
  objects: TaggableObject[],
  connections: TaggableConnection[],
  symbolTypes: SymbolPrefixSource[],
  areas: TagArea[] = [],
  options: { force?: boolean } = {},
): RetagPlan {
  return {
    tags: generateTags(objects, symbolTypes, areas, options),
    cables: generateCableNumbers(connections, objects, areas, options),
  };
}
