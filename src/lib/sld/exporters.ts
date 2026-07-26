// P-147 — Pure SLD import/export engines: SVG, PNG, JSON, CSV and a minimal
// original DXF R12 writer. No React and no Supabase imports so the whole module
// is unit-testable and reusable from both the server fns and the browser.
import { z } from "zod";

import { objectsToCsv } from "@/lib/csv";
import { SHEET_SIZES, type SheetSize } from "./canvas-types";
import { orthogonalRoute, type Pt } from "./geometry";
import { footprintFor, sanitizeSvgBody, viewBoxToMm, SYMBOL_VIEWBOX } from "./symbol-registry";
import type { LegendRow, TitleBlockRow } from "./schedules";

// --- shared shapes ---------------------------------------------------------

export type ExportObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  label?: string | null;
  x: number;
  y: number;
  rotation: number;
  mirrored: boolean;
  layer_id: string;
  properties?: Record<string, unknown> | null;
};

export type ExportConnection = {
  id: string;
  from_object_id: string;
  from_port: string;
  to_object_id: string;
  to_port: string;
  connection_type: string;
  cable_number?: string | null;
  properties?: Record<string, unknown> | null;
};

export type ExportGraph = { objects: ExportObject[]; connections: ExportConnection[] };

export type ExportSymbol = {
  type_key: string;
  display_name?: string | null;
  svg_body?: string | null;
  ports?: Array<{ key: string; x: number; y: number }>;
};

export type ExportSheet = {
  size: SheetSize;
  titleBlock?: TitleBlockRow | null;
  legend?: LegendRow[];
  layers?: Array<{ id: string; name: string }>;
};

export const TITLE_LAYER = "GRIDMIND-TITLE";
const BORDER_MM = 10;
const TITLE_W = 180;
const TITLE_H = 44;

function symbolOf(symbols: ExportSymbol[], typeKey: string): ExportSymbol | undefined {
  return symbols.find((s) => s.type_key === typeKey);
}

export function footprintOf(typeKey: string): { w: number; h: number } {
  return footprintFor(typeKey);
}

function applyTransform(offset: Pt, rotation: number, mirrored: boolean): Pt {
  const x = mirrored ? -offset.x : offset.x;
  const rad = ((rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - offset.y * sin, y: x * sin + offset.y * cos };
}

/** Absolute mm position of a port on a placed object. */
export function portPoint(
  obj: ExportObject,
  symbol: ExportSymbol | undefined,
  portKey: string,
): Pt {
  const { w, h } = footprintFor(obj.symbol_type);
  const spec = (symbol?.ports ?? []).find((p) => p.key === portKey);
  if (!spec) return { x: obj.x, y: obj.y };
  const local = { x: viewBoxToMm(spec.x, w), y: viewBoxToMm(spec.y, h) };
  const t = applyTransform(local, obj.rotation ?? 0, Boolean(obj.mirrored));
  return { x: obj.x + t.x, y: obj.y + t.y };
}

/** Orthogonal route (mm) for one connection, or null when an endpoint is gone. */
export function connectionRoute(
  conn: ExportConnection,
  objects: ExportObject[],
  symbols: ExportSymbol[],
): Pt[] | null {
  const from = objects.find((o) => o.id === conn.from_object_id);
  const to = objects.find((o) => o.id === conn.to_object_id);
  if (!from || !to) return null;
  const a = portPoint(from, symbolOf(symbols, from.symbol_type), conn.from_port);
  const b = portPoint(to, symbolOf(symbols, to.symbol_type), conn.to_port);
  return orthogonalRoute(a, b);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

// --- SVG -------------------------------------------------------------------

/**
 * Standalone sheet SVG: border, title block, symbols, orthogonal connections
 * and the on-sheet legend. Strokes are token-neutral (currentColor) — brand
 * colours belong to the PDF wrapper only.
 */
export function toSvg(graph: ExportGraph, symbols: ExportSymbol[], sheet: ExportSheet): string {
  const size = SHEET_SIZES[sheet.size] ?? SHEET_SIZES.A1;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}mm" height="${size.h}mm" viewBox="0 0 ${size.w} ${size.h}" color="#111111">`,
  );
  parts.push(
    `<rect x="0" y="0" width="${size.w}" height="${size.h}" fill="#ffffff" stroke="none"/>`,
  );
  parts.push(
    `<g fill="none" stroke="currentColor" stroke-width="0.5"><rect x="${BORDER_MM}" y="${BORDER_MM}" width="${size.w - BORDER_MM * 2}" height="${size.h - BORDER_MM * 2}"/></g>`,
  );

  // connections
  parts.push(`<g fill="none" stroke="currentColor" stroke-width="0.4">`);
  for (const conn of graph.connections) {
    const route = connectionRoute(conn, graph.objects, symbols);
    if (!route || route.length < 2) continue;
    const d = route.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ");
    parts.push(`<path d="${d}" data-connection="${esc(conn.id)}"/>`);
    if (conn.cable_number) {
      const mid = route[Math.floor(route.length / 2)];
      parts.push(
        `<text x="${n(mid.x + 1)}" y="${n(mid.y - 1)}" font-size="2.4" fill="currentColor" stroke="none">${esc(conn.cable_number)}</text>`,
      );
    }
  }
  parts.push(`</g>`);

  // symbols
  for (const obj of graph.objects) {
    const symbol = symbolOf(symbols, obj.symbol_type);
    const { w, h } = footprintFor(obj.symbol_type);
    const scaleX = (obj.mirrored ? -1 : 1) * (w / SYMBOL_VIEWBOX);
    const scaleY = h / SYMBOL_VIEWBOX;
    const body = sanitizeSvgBody(symbol?.svg_body ?? "");
    parts.push(
      `<g transform="translate(${n(obj.x)} ${n(obj.y)}) rotate(${n(obj.rotation ?? 0)}) scale(${n(scaleX)} ${n(scaleY)}) translate(${-SYMBOL_VIEWBOX / 2} ${-SYMBOL_VIEWBOX / 2})" fill="none" stroke="currentColor" stroke-width="1.2" data-object="${esc(obj.id)}">${body}</g>`,
    );
    const caption = obj.tag ?? obj.label ?? null;
    if (caption) {
      parts.push(
        `<text x="${n(obj.x)}" y="${n(obj.y + h / 2 + 3.2)}" font-size="2.8" text-anchor="middle" fill="currentColor">${esc(caption)}</text>`,
      );
    }
  }

  // legend
  const legend = sheet.legend ?? [];
  if (legend.length > 0) {
    const lx = size.w - BORDER_MM - 70;
    const ly = BORDER_MM + 6;
    parts.push(
      `<g stroke="currentColor" fill="none" stroke-width="0.3"><rect x="${lx}" y="${ly}" width="70" height="${8 + legend.length * 5}"/></g>`,
    );
    parts.push(
      `<text x="${lx + 3}" y="${ly + 5.5}" font-size="3.2" fill="currentColor">LEGEND</text>`,
    );
    legend.forEach((row, i) => {
      parts.push(
        `<text x="${lx + 3}" y="${ly + 11 + i * 5}" font-size="2.6" fill="currentColor">${esc(row.symbol_type)} — ${esc(row.description)} (${esc(row.count)})</text>`,
      );
    });
  }

  // title block
  const tb = sheet.titleBlock ?? null;
  const tx = size.w - BORDER_MM - TITLE_W;
  const ty = size.h - BORDER_MM - TITLE_H;
  parts.push(
    `<g stroke="currentColor" fill="none" stroke-width="0.5"><rect x="${tx}" y="${ty}" width="${TITLE_W}" height="${TITLE_H}"/><line x1="${tx}" y1="${ty + 14}" x2="${tx + TITLE_W}" y2="${ty + 14}"/><line x1="${tx}" y1="${ty + 29}" x2="${tx + TITLE_W}" y2="${ty + 29}"/></g>`,
  );
  const line = (text: string, dy: number, sizePt: number) =>
    parts.push(
      `<text x="${tx + 3}" y="${ty + dy}" font-size="${sizePt}" fill="currentColor">${esc(text)}</text>`,
    );
  line(tb?.company_name ?? "GridMind", 6, 3.4);
  line(tb?.project_name ?? "", 11.5, 3);
  line(tb?.title ?? "Single line diagram", 21, 4);
  line(tb?.drawing_number ?? "", 26.5, 3);
  line(
    [
      tb?.revision_code ? `Rev ${tb.revision_code}` : null,
      tb?.status ?? null,
      tb?.drawn_by ? `Drawn ${tb.drawn_by}` : null,
      tb?.revision_date ? String(tb.revision_date).slice(0, 10) : null,
    ]
      .filter(Boolean)
      .join("  ·  "),
    36,
    3,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}

// --- PNG (browser only) ----------------------------------------------------

/** Rasterizes an SVG string through the canvas API (2× by default). */
export async function toPng(svgString: string, scale = 2): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("toPng requires a browser environment");
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterize the drawing"));
      img.src = url;
    });
    const width = Math.max(1, Math.round((img.naturalWidth || 1200) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 800) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- JSON round-trip -------------------------------------------------------

export const SLD_JSON_FORMAT = "gridmind-sld";
export const SLD_JSON_VERSION = 1;
export const MAX_IMPORT_OBJECTS = 10000;

const objectSchema = z.object({
  id: z.string().min(1),
  symbol_type: z.string().min(1),
  tag: z.string().nullable().default(null),
  label: z.string().nullable().optional().default(null),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  mirrored: z.boolean().default(false),
  layer_id: z.string().default("default"),
  properties: z.record(z.string(), z.unknown()).nullable().optional().default({}),
});

const connectionSchema = z.object({
  id: z.string().min(1),
  from_object_id: z.string().min(1),
  from_port: z.string().min(1),
  to_object_id: z.string().min(1),
  to_port: z.string().min(1),
  connection_type: z.string().min(1),
  cable_number: z.string().nullable().optional().default(null),
  properties: z.record(z.string(), z.unknown()).nullable().optional().default({}),
});

export const sldJsonSchema = z.object({
  format: z.literal(SLD_JSON_FORMAT),
  version: z.number().int().positive(),
  objects: z.array(objectSchema),
  connections: z.array(connectionSchema),
});

export type SldJsonDocument = z.infer<typeof sldJsonSchema>;

export function toJson(graph: ExportGraph): SldJsonDocument {
  return {
    format: SLD_JSON_FORMAT,
    version: SLD_JSON_VERSION,
    objects: graph.objects.map((o) => ({
      id: o.id,
      symbol_type: o.symbol_type,
      tag: o.tag ?? null,
      label: o.label ?? null,
      x: o.x,
      y: o.y,
      rotation: o.rotation ?? 0,
      mirrored: Boolean(o.mirrored),
      layer_id: o.layer_id,
      properties: (o.properties ?? {}) as Record<string, unknown>,
    })),
    connections: graph.connections.map((c) => ({
      id: c.id,
      from_object_id: c.from_object_id,
      from_port: c.from_port,
      to_object_id: c.to_object_id,
      to_port: c.to_port,
      connection_type: c.connection_type,
      cable_number: c.cable_number ?? null,
      properties: (c.properties ?? {}) as Record<string, unknown>,
    })),
  };
}

export class SldImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Parses and validates an exported document back into a graph. */
export function fromJson(input: unknown): ExportGraph {
  const raw = typeof input === "string" ? safeParse(input) : input;
  const parsed = sldJsonSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SldImportError(
      "invalid_document",
      "This file is not a GridMind SLD export (expected format \"gridmind-sld\").",
    );
  }
  const doc = parsed.data;
  if (doc.version > SLD_JSON_VERSION) {
    throw new SldImportError(
      "unsupported_version",
      `This file was written by a newer version (v${doc.version}); this app reads v${SLD_JSON_VERSION}.`,
    );
  }
  if (doc.objects.length > MAX_IMPORT_OBJECTS) {
    throw new SldImportError(
      "too_large",
      `File too large: ${doc.objects.length} objects exceeds the ${MAX_IMPORT_OBJECTS} object limit.`,
    );
  }
  const ids = new Set(doc.objects.map((o) => o.id));
  return {
    objects: doc.objects as ExportObject[],
    connections: (doc.connections as ExportConnection[]).filter(
      (c) => ids.has(c.from_object_id) && ids.has(c.to_object_id),
    ),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SldImportError("invalid_json", "The file is not valid JSON.");
  }
}

// --- CSV -------------------------------------------------------------------

/** Schedule rows → CSV through the shared helper. */
export function toCsv(scheduleRows: Record<string, unknown>[]): string {
  return objectsToCsv(scheduleRows);
}

// --- DXF R12 ---------------------------------------------------------------

export type DxfPrimitive =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "polyline"; points: Pt[]; closed: boolean };

export type DxfResult = { dxf: string; warnings: string[] };

const NUM = "-?\\d*\\.?\\d+(?:e-?\\d+)?";

function attr(tag: string, name: string): number | null {
  const m = new RegExp(`${name}\\s*=\\s*"(${NUM})"`, "i").exec(tag);
  return m ? Number(m[1]) : null;
}

/**
 * Minimal SVG primitive reader for block geometry: line, polyline, circle,
 * rect and path M/L/Z only. Anything else is reported as a warning and skipped.
 */
export function parseSvgPrimitives(svgBody: string): {
  primitives: DxfPrimitive[];
  warnings: string[];
} {
  const primitives: DxfPrimitive[] = [];
  const warnings: string[] = [];
  const tags = String(svgBody ?? "").match(/<\s*[a-zA-Z][^>]*>/g) ?? [];

  for (const tag of tags) {
    const name = (/<\s*([a-zA-Z]+)/.exec(tag)?.[1] ?? "").toLowerCase();
    if (name === "g" || name === "svg" || name === "title" || name === "desc") continue;

    if (name === "line") {
      const x1 = attr(tag, "x1") ?? 0;
      const y1 = attr(tag, "y1") ?? 0;
      const x2 = attr(tag, "x2") ?? 0;
      const y2 = attr(tag, "y2") ?? 0;
      primitives.push({ kind: "line", x1, y1, x2, y2 });
    } else if (name === "circle") {
      primitives.push({
        kind: "circle",
        cx: attr(tag, "cx") ?? 0,
        cy: attr(tag, "cy") ?? 0,
        r: attr(tag, "r") ?? 0,
      });
    } else if (name === "rect") {
      const x = attr(tag, "x") ?? 0;
      const y = attr(tag, "y") ?? 0;
      const w = attr(tag, "width") ?? 0;
      const h = attr(tag, "height") ?? 0;
      primitives.push({
        kind: "polyline",
        closed: true,
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      });
    } else if (name === "polyline" || name === "polygon") {
      const raw = /points\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
      const nums = raw.match(new RegExp(NUM, "g"))?.map(Number) ?? [];
      const points: Pt[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
      if (points.length >= 2)
        primitives.push({ kind: "polyline", points, closed: name === "polygon" });
    } else if (name === "path") {
      const d = /\sd\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
      const parsed = parseSimplePath(d);
      if (parsed) primitives.push(parsed);
      else warnings.push(`Skipped path with unsupported commands: ${d.slice(0, 40)}`);
    } else {
      warnings.push(`Skipped unsupported SVG element <${name}> in DXF export`);
    }
  }

  return { primitives, warnings };
}

/** Absolute M/L/Z paths only — curves and relative commands are rejected. */
function parseSimplePath(d: string): DxfPrimitive | null {
  const cmds = d.match(/[a-zA-Z][^a-zA-Z]*/g) ?? [];
  const points: Pt[] = [];
  let closed = false;
  for (const cmd of cmds) {
    const head = cmd[0];
    const nums = cmd.slice(1).match(new RegExp(NUM, "g"))?.map(Number) ?? [];
    if (head === "M" || head === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
    } else if (head === "Z" || head === "z") {
      closed = true;
    } else {
      return null;
    }
  }
  if (points.length < 2) return null;
  return { kind: "polyline", points, closed };
}

function code(out: string[], groupCode: number | string, value: string | number) {
  out.push(String(groupCode));
  out.push(typeof value === "number" ? n(value) : value);
}

function dxfName(value: string): string {
  return (
    String(value ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "_")
      .slice(0, 31) || "LAYER0"
  );
}

function blockPrimitives(
  symbol: ExportSymbol | undefined,
  typeKey: string,
): { primitives: DxfPrimitive[]; warnings: string[] } {
  const { primitives, warnings } = parseSvgPrimitives(sanitizeSvgBody(symbol?.svg_body ?? ""));
  const { w, h } = footprintFor(typeKey);
  const mx = (v: number) => viewBoxToMm(v, w);
  // DXF is Y-up; the SVG viewBox is Y-down.
  const my = (v: number) => -viewBoxToMm(v, h);
  const scaled = primitives.map((p): DxfPrimitive => {
    if (p.kind === "line")
      return { kind: "line", x1: mx(p.x1), y1: my(p.y1), x2: mx(p.x2), y2: my(p.y2) };
    if (p.kind === "circle")
      return {
        kind: "circle",
        cx: mx(p.cx),
        cy: my(p.cy),
        r: (p.r / SYMBOL_VIEWBOX) * Math.min(w, h),
      };
    return {
      kind: "polyline",
      closed: p.closed,
      points: p.points.map((pt) => ({ x: mx(pt.x), y: my(pt.y) })),
    };
  });
  return { primitives: scaled, warnings: warnings.map((msg) => `${typeKey}: ${msg}`) };
}

function emitPrimitive(out: string[], layer: string, p: DxfPrimitive) {
  if (p.kind === "line") {
    code(out, 0, "LINE");
    code(out, 8, layer);
    code(out, 10, p.x1);
    code(out, 20, p.y1);
    code(out, 30, 0);
    code(out, 11, p.x2);
    code(out, 21, p.y2);
    code(out, 31, 0);
    return;
  }
  if (p.kind === "circle") {
    code(out, 0, "CIRCLE");
    code(out, 8, layer);
    code(out, 10, p.cx);
    code(out, 20, p.cy);
    code(out, 30, 0);
    code(out, 40, p.r);
    return;
  }
  emitPolyline(out, layer, p.points, p.closed);
}

function emitPolyline(out: string[], layer: string, points: Pt[], closed: boolean) {
  if (points.length < 2) return;
  code(out, 0, "POLYLINE");
  code(out, 8, layer);
  code(out, 66, 1);
  code(out, 70, closed ? 1 : 0);
  code(out, 10, 0);
  code(out, 20, 0);
  code(out, 30, 0);
  for (const pt of points) {
    code(out, 0, "VERTEX");
    code(out, 8, layer);
    code(out, 10, pt.x);
    code(out, 20, pt.y);
    code(out, 30, 0);
  }
  code(out, 0, "SEQEND");
  code(out, 8, layer);
}

function emitText(out: string[], layer: string, x: number, y: number, height: number, s: string) {
  if (!s) return;
  code(out, 0, "TEXT");
  code(out, 8, layer);
  code(out, 10, x);
  code(out, 20, y);
  code(out, 30, 0);
  code(out, 40, height);
  code(out, 1, String(s).slice(0, 240));
}

/**
 * Original minimal DXF R12 writer: HEADER (mm), TABLES/LAYER, BLOCKS built from
 * registry SVG primitives, and an ENTITIES section of INSERT/POLYLINE/TEXT.
 */
export function toDxf(
  graph: ExportGraph,
  symbols: ExportSymbol[],
  sheet: ExportSheet = { size: "A1" },
): DxfResult {
  const size = SHEET_SIZES[sheet.size] ?? SHEET_SIZES.A1;
  const flipY = (y: number) => size.h - y;
  const warnings: string[] = [];
  const out: string[] = [];

  // layers: one per canvas layer used + the title layer
  const layerNames = new Set<string>([TITLE_LAYER]);
  const layerFor = (id: string) => {
    const named = (sheet.layers ?? []).find((l) => l.id === id)?.name ?? id;
    return dxfName(named);
  };
  for (const obj of graph.objects) layerNames.add(layerFor(obj.layer_id));
  for (const l of sheet.layers ?? []) layerNames.add(dxfName(l.name));

  // HEADER — millimetres
  code(out, 0, "SECTION");
  code(out, 2, "HEADER");
  code(out, 9, "$ACADVER");
  code(out, 1, "AC1009");
  code(out, 9, "$INSUNITS");
  code(out, 70, 4);
  code(out, 9, "$MEASUREMENT");
  code(out, 70, 1);
  code(out, 9, "$EXTMIN");
  code(out, 10, 0);
  code(out, 20, 0);
  code(out, 9, "$EXTMAX");
  code(out, 10, size.w);
  code(out, 20, size.h);
  code(out, 0, "ENDSEC");

  // TABLES / LAYER
  code(out, 0, "SECTION");
  code(out, 2, "TABLES");
  code(out, 0, "TABLE");
  code(out, 2, "LAYER");
  code(out, 70, layerNames.size);
  for (const layer of layerNames) {
    code(out, 0, "LAYER");
    code(out, 2, layer);
    code(out, 70, 0);
    code(out, 62, 7);
    code(out, 6, "CONTINUOUS");
  }
  code(out, 0, "ENDTAB");
  code(out, 0, "ENDSEC");

  // BLOCKS — one per symbol type actually used
  const usedTypes = [...new Set(graph.objects.map((o) => o.symbol_type))];
  const blockName = (typeKey: string) => dxfName(`SYM_${typeKey}`);
  code(out, 0, "SECTION");
  code(out, 2, "BLOCKS");
  for (const typeKey of usedTypes) {
    const symbol = symbols.find((s) => s.type_key === typeKey);
    if (!symbol) warnings.push(`${typeKey}: symbol not in registry — block left empty`);
    const { primitives, warnings: w } = blockPrimitives(symbol, typeKey);
    warnings.push(...w);
    const name = blockName(typeKey);
    code(out, 0, "BLOCK");
    code(out, 8, "0");
    code(out, 2, name);
    code(out, 70, 0);
    code(out, 10, 0);
    code(out, 20, 0);
    code(out, 30, 0);
    code(out, 3, name);
    code(out, 1, "");
    for (const p of primitives) emitPrimitive(out, "0", p);
    code(out, 0, "ENDBLK");
    code(out, 8, "0");
  }
  code(out, 0, "ENDSEC");

  // ENTITIES
  code(out, 0, "SECTION");
  code(out, 2, "ENTITIES");

  // sheet border
  emitPolyline(
    out,
    TITLE_LAYER,
    [
      { x: BORDER_MM, y: BORDER_MM },
      { x: size.w - BORDER_MM, y: BORDER_MM },
      { x: size.w - BORDER_MM, y: size.h - BORDER_MM },
      { x: BORDER_MM, y: size.h - BORDER_MM },
    ],
    true,
  );
  const tb = sheet.titleBlock ?? null;
  if (tb) {
    const tx = size.w - BORDER_MM - TITLE_W;
    const ty = BORDER_MM;
    emitPolyline(
      out,
      TITLE_LAYER,
      [
        { x: tx, y: ty },
        { x: tx + TITLE_W, y: ty },
        { x: tx + TITLE_W, y: ty + TITLE_H },
        { x: tx, y: ty + TITLE_H },
      ],
      true,
    );
    emitText(out, TITLE_LAYER, tx + 3, ty + TITLE_H - 8, 4, tb.title ?? "");
    emitText(out, TITLE_LAYER, tx + 3, ty + TITLE_H - 16, 3, tb.drawing_number ?? "");
    emitText(
      out,
      TITLE_LAYER,
      tx + 3,
      ty + 5,
      3,
      [tb.revision_code ? `REV ${tb.revision_code}` : null, tb.status ?? null]
        .filter(Boolean)
        .join("  "),
    );
  }

  for (const conn of graph.connections) {
    const route = connectionRoute(conn, graph.objects, symbols);
    if (!route || route.length < 2) continue;
    const pts = route.map((p) => ({ x: p.x, y: flipY(p.y) }));
    const layer = dxfName(conn.connection_type);
    layerNames.add(layer);
    if (pts.length === 2) {
      emitPrimitive(out, layer, {
        kind: "line",
        x1: pts[0].x,
        y1: pts[0].y,
        x2: pts[1].x,
        y2: pts[1].y,
      });
    } else {
      emitPolyline(out, layer, pts, false);
    }
    if (conn.cable_number) {
      const mid = pts[Math.floor(pts.length / 2)];
      emitText(out, layer, mid.x + 1, mid.y + 1, 2.5, conn.cable_number);
    }
  }

  for (const obj of graph.objects) {
    const layer = layerFor(obj.layer_id);
    code(out, 0, "INSERT");
    code(out, 8, layer);
    code(out, 2, blockName(obj.symbol_type));
    code(out, 10, obj.x);
    code(out, 20, flipY(obj.y));
    code(out, 30, 0);
    code(out, 41, obj.mirrored ? -1 : 1);
    code(out, 42, 1);
    code(out, 43, 1);
    code(out, 50, (360 - ((obj.rotation ?? 0) % 360)) % 360);
    const caption = obj.tag ?? obj.label ?? "";
    if (caption) {
      const { h } = footprintFor(obj.symbol_type);
      emitText(out, layer, obj.x, flipY(obj.y) - h / 2 - 4, 2.8, caption);
    }
  }

  code(out, 0, "ENDSEC");
  code(out, 0, "EOF");

  return { dxf: out.join("\n") + "\n", warnings };
}

/** Structural sanity gate used by the server fn before storing a DXF. */
export function isValidDxf(dxf: string): boolean {
  return dxf.startsWith("0\nSECTION") && dxf.trimEnd().endsWith("EOF");
}

/**
 * Rasterizes an SVG string to PNG in the browser (2× by default).
 * Browser-only: needs Image + canvas.
 */
export function toPng(svgString: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.width || 1600) * scale));
      canvas.height = Math.max(1, Math.round((img.height || 1131) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas is not available in this browser"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not rasterize the drawing"))),
        "image/png",
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize the drawing"));
    };
    img.src = url;
  });
}
