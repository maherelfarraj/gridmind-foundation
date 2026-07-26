// P-162 — Civil feature type catalogue. Pure metadata shared by the editor,
// the zod schemas and the server-side geometry-kind guard.

export const CIVIL_FEATURE_TYPES = [
  "grading_zone",
  "flood_risk_zone",
  "equipment_platform",
  "laydown_area",
  "construction_compound",
  "drainage_path",
  "road_alignment",
  "trench_route",
  "fence_line",
  "crane_access",
  "emergency_access",
  "gate",
] as const;

export type CivilFeatureType = (typeof CIVIL_FEATURE_TYPES)[number];
export type GeometryKind = "polygon" | "line" | "point";

export type CivilFieldSpec = {
  key: string;
  label: string;
  kind: "number" | "text" | "select";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
};

export type CivilTypeSpec = {
  type: CivilFeatureType;
  label: string;
  kind: GeometryKind;
  /** CSS custom property carrying this type's colour (theme tokens only). */
  cssVar: string;
  fields: CivilFieldSpec[];
};

const width = (key = "width_m", label = "Width"): CivilFieldSpec => ({
  key,
  label,
  kind: "number",
  unit: "m",
  min: 0,
  step: 0.1,
});

export const CIVIL_TYPE_SPECS: Record<CivilFeatureType, CivilTypeSpec> = {
  grading_zone: {
    type: "grading_zone",
    label: "Grading zone",
    kind: "polygon",
    cssVar: "--civil-grading",
    fields: [
      {
        key: "design_elevation_m",
        label: "Design elevation",
        kind: "number",
        unit: "m",
        step: 0.01,
      },
      { key: "design_slope_pct", label: "Design slope", kind: "number", unit: "%", step: 0.1 },
      {
        key: "design_slope_direction_deg",
        label: "Slope direction",
        kind: "number",
        unit: "°",
        min: 0,
        max: 360,
        step: 1,
      },
    ],
  },
  flood_risk_zone: {
    type: "flood_risk_zone",
    label: "Flood risk zone",
    kind: "polygon",
    cssVar: "--civil-flood",
    fields: [
      {
        key: "return_period_years",
        label: "Return period",
        kind: "select",
        options: ["10", "25", "50", "100", "200"],
      },
      { key: "peak_depth_m", label: "Peak depth", kind: "number", unit: "m", min: 0, step: 0.05 },
    ],
  },
  equipment_platform: {
    type: "equipment_platform",
    label: "Equipment platform",
    kind: "polygon",
    cssVar: "--civil-platform",
    fields: [
      {
        key: "design_elevation_m",
        label: "Design elevation",
        kind: "number",
        unit: "m",
        step: 0.01,
      },
      {
        key: "bearing_capacity_kpa",
        label: "Bearing capacity",
        kind: "number",
        unit: "kPa",
        min: 0,
        step: 5,
      },
    ],
  },
  laydown_area: {
    type: "laydown_area",
    label: "Laydown area",
    kind: "polygon",
    cssVar: "--civil-laydown",
    fields: [
      {
        key: "surface_treatment",
        label: "Surface",
        kind: "select",
        options: ["compacted_gravel", "concrete", "asphalt", "natural"],
      },
    ],
  },
  construction_compound: {
    type: "construction_compound",
    label: "Construction compound",
    kind: "polygon",
    cssVar: "--civil-compound",
    fields: [{ key: "capacity_persons", label: "Capacity", kind: "number", min: 0, step: 1 }],
  },
  drainage_path: {
    type: "drainage_path",
    label: "Drainage path",
    kind: "line",
    cssVar: "--civil-drainage",
    fields: [
      width("channel_width_m", "Channel width"),
      { key: "invert_slope_pct", label: "Invert slope", kind: "number", unit: "%", step: 0.1 },
    ],
  },
  road_alignment: {
    type: "road_alignment",
    label: "Road alignment",
    kind: "line",
    cssVar: "--civil-road",
    fields: [
      width(),
      {
        key: "surface_type",
        label: "Surface",
        kind: "select",
        options: ["gravel", "asphalt", "concrete", "graded_earth"],
      },
      {
        key: "design_speed_kph",
        label: "Design speed",
        kind: "number",
        unit: "km/h",
        min: 0,
        step: 5,
      },
    ],
  },
  trench_route: {
    type: "trench_route",
    label: "Trench route",
    kind: "line",
    cssVar: "--civil-trench",
    fields: [
      width("trench_width_m", "Trench width"),
      { key: "depth_m", label: "Depth", kind: "number", unit: "m", min: 0, step: 0.05 },
      {
        key: "service",
        label: "Service",
        kind: "select",
        options: ["dc_cable", "ac_mv", "comms", "water", "mixed"],
      },
    ],
  },
  fence_line: {
    type: "fence_line",
    label: "Fence line",
    kind: "line",
    cssVar: "--civil-fence",
    fields: [
      { key: "height_m", label: "Height", kind: "number", unit: "m", min: 0, step: 0.1 },
      {
        key: "fence_type",
        label: "Fence type",
        kind: "select",
        options: ["chainlink", "palisade", "welded_mesh", "electric"],
      },
    ],
  },
  crane_access: {
    type: "crane_access",
    label: "Crane access",
    kind: "line",
    cssVar: "--civil-crane",
    fields: [
      width(),
      {
        key: "max_axle_load_t",
        label: "Max axle load",
        kind: "number",
        unit: "t",
        min: 0,
        step: 0.5,
      },
    ],
  },
  emergency_access: {
    type: "emergency_access",
    label: "Emergency access",
    kind: "line",
    cssVar: "--civil-emergency",
    fields: [
      width(),
      {
        key: "turning_radius_m",
        label: "Turning radius",
        kind: "number",
        unit: "m",
        min: 0,
        step: 0.5,
      },
    ],
  },
  gate: {
    type: "gate",
    label: "Gate",
    kind: "point",
    cssVar: "--civil-gate",
    fields: [
      width(),
      { key: "swing", label: "Swing", kind: "select", options: ["inward", "outward", "sliding"] },
      {
        key: "access_control",
        label: "Access control",
        kind: "select",
        options: ["manual", "keypad", "card", "guarded"],
      },
    ],
  },
};

export const CIVIL_TYPE_LIST: CivilTypeSpec[] = CIVIL_FEATURE_TYPES.map((t) => CIVIL_TYPE_SPECS[t]);

export function geometryKindFor(type: string): GeometryKind | null {
  const spec = CIVIL_TYPE_SPECS[type as CivilFeatureType];
  return spec ? spec.kind : null;
}

export function isCivilFeatureType(value: unknown): value is CivilFeatureType {
  return typeof value === "string" && value in CIVIL_TYPE_SPECS;
}

const ALLOWED_GEOMETRY: Record<GeometryKind, string[]> = {
  polygon: ["Polygon", "MultiPolygon"],
  line: ["LineString", "MultiLineString"],
  point: ["Point"],
};

/** Mirrors public.civil_geometry_matches — the DB stays the source of truth. */
export function geometryMatchesType(type: string, geometryType: string | undefined): boolean {
  const kind = geometryKindFor(type);
  if (!kind || !geometryType) return false;
  return ALLOWED_GEOMETRY[kind].includes(geometryType);
}

export function allowedGeometryTypes(type: string): string[] {
  const kind = geometryKindFor(type);
  return kind ? [...ALLOWED_GEOMETRY[kind]] : [];
}

/** Minimum vertex count for a finished sketch of this kind. */
export function minVertices(kind: GeometryKind): number {
  return kind === "polygon" ? 3 : kind === "line" ? 2 : 1;
}

export const CIVIL_STATUSES = ["draft", "under_review", "approved", "superseded"] as const;
export type CivilStatus = (typeof CIVIL_STATUSES)[number];

/** Approved features are frozen until a new revision is cut. */
export function isReadOnlyStatus(status: string): boolean {
  return status === "approved" || status === "superseded";
}

/** A → B → … → Z → AA. */
export function nextRevisionCode(code: string): string {
  const trimmed = (code || "A").trim().toUpperCase();
  const chars = trimmed.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === "Z") {
      chars[i] = "A";
      i -= 1;
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join("");
    }
  }
  return `A${chars.join("")}`;
}

export function formatFeatureRef(sequence: number): string {
  return `CVL-${String(Math.max(1, Math.floor(sequence))).padStart(4, "0")}`;
}
