// P-145 — Pure geometry helpers for the revision-cloud markup layer.
// No React / Supabase imports so this stays unit-testable.
import type { Pt, Rect } from "./geometry";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Axis-aligned bounding rect around a point cloud, optionally padded. */
export function rectAround(points: Pt[], padMm = 0): Rect | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: round(Math.min(...xs) - padMm),
    minY: round(Math.min(...ys) - padMm),
    maxX: round(Math.max(...xs) + padMm),
    maxY: round(Math.max(...ys) + padMm),
  };
}

/**
 * Closed revision cloud: a rectangle traced with outward scallop arcs.
 * `arcMm` is the nominal scallop chord; each side uses a whole number of
 * scallops so the path always closes exactly on the corner.
 */
export function cloudPath(rect: Rect, arcMm = 6): string {
  const chord = Math.max(2, arcMm);
  const x = rect.minX;
  const y = rect.minY;
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  if (w <= 0 || h <= 0) return "";

  const nx = Math.max(1, Math.round(w / chord));
  const ny = Math.max(1, Math.round(h / chord));
  const sx = w / nx;
  const sy = h / ny;
  const rx = sx / 2;
  const ry = sy / 2;

  const parts: string[] = [`M ${round(x)} ${round(y)}`];
  // sweep=1 bulges outward for top/right, sweep=0 keeps bottom/left outward too
  for (let i = 1; i <= nx; i++)
    parts.push(`A ${round(rx)} ${round(rx)} 0 0 1 ${round(x + i * sx)} ${round(y)}`);
  for (let i = 1; i <= ny; i++)
    parts.push(`A ${round(ry)} ${round(ry)} 0 0 1 ${round(x + w)} ${round(y + i * sy)}`);
  for (let i = 1; i <= nx; i++)
    parts.push(`A ${round(rx)} ${round(rx)} 0 0 1 ${round(x + w - i * sx)} ${round(y + h)}`);
  for (let i = 1; i <= ny; i++)
    parts.push(`A ${round(ry)} ${round(ry)} 0 0 1 ${round(x)} ${round(y + h - i * sy)}`);
  parts.push("Z");
  return parts.join(" ");
}

/** Arrow head polygon points for a two-point arrow markup. */
export function arrowHead(from: Pt, to: Pt, sizeMm = 4): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const base = { x: to.x - ux * sizeMm, y: to.y - uy * sizeMm };
  return [
    { x: round(to.x), y: round(to.y) },
    { x: round(base.x + px * sizeMm * 0.4), y: round(base.y + py * sizeMm * 0.4) },
    { x: round(base.x - px * sizeMm * 0.4), y: round(base.y - py * sizeMm * 0.4) },
  ];
}
