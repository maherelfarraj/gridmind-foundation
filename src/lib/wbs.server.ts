// P-072 — Server-only helpers for WBS. Not import-safe on client.
import type { WbsDiscipline } from "@/lib/wbs-rules";

export interface IfcPackageProposal {
  code: string;
  name: string;
  discipline: WbsDiscipline | null;
  ifc_package_ref: string;
  release_id: string;
  release_name: string;
  released_at: string | null;
  already_imported: boolean;
  drawing_count: number;
}

const DRAWING_DISCIPLINE_MAP: Record<string, WbsDiscipline> = {
  civil: "civil",
  structural: "civil",
  mechanical: "mechanical",
  electrical: "electrical",
  instrumentation: "instrumentation",
  scada: "scada",
  control: "scada",
  hse: "hse",
  safety: "hse",
  commercial: "commercial",
  process: "mechanical",
};

export function mapDrawingDiscipline(
  raw: string | null | undefined,
): WbsDiscipline | null {
  if (!raw) return null;
  return DRAWING_DISCIPLINE_MAP[String(raw).toLowerCase()] ?? null;
}

/**
 * Turn released IFC packages into WBS package proposals. One proposal per
 * release; discipline inferred from the majority discipline of its drawings
 * (via revision_snapshot → drawing_register).
 */
export function buildIfcProposals(
  releases: Array<{
    id: string;
    package_name: string;
    released_at: string | null;
    revision_snapshot: unknown;
  }>,
  drawingsById: Map<
    string,
    { discipline: string | null; drawing_number: string; title: string }
  >,
  alreadyImportedRefs: Set<string>,
  usedCodes: Set<string>,
  rootPrefix: string,
): IfcPackageProposal[] {
  const proposals: IfcPackageProposal[] = [];
  let cursor = 1;
  for (const rel of releases) {
    const snapshot = Array.isArray(rel.revision_snapshot)
      ? (rel.revision_snapshot as unknown[])
      : [];
    const disciplines = new Map<WbsDiscipline, number>();
    let drawingCount = 0;
    for (const entry of snapshot) {
      const rev = entry as { drawing_id?: string; revision_id?: string };
      const drawingId = rev?.drawing_id;
      if (!drawingId) continue;
      const drawing = drawingsById.get(drawingId);
      if (!drawing) continue;
      drawingCount += 1;
      const mapped = mapDrawingDiscipline(drawing.discipline);
      if (mapped) disciplines.set(mapped, (disciplines.get(mapped) ?? 0) + 1);
    }
    let discipline: WbsDiscipline | null = null;
    let best = 0;
    for (const [d, n] of disciplines) {
      if (n > best) {
        best = n;
        discipline = d;
      }
    }
    // suggest first unused `<root>.<n>` code
    let code = `${rootPrefix}.${cursor}`;
    while (usedCodes.has(code)) {
      cursor += 1;
      code = `${rootPrefix}.${cursor}`;
    }
    usedCodes.add(code);
    cursor += 1;
    proposals.push({
      code,
      name: rel.package_name,
      discipline,
      ifc_package_ref: rel.id,
      release_id: rel.id,
      release_name: rel.package_name,
      released_at: rel.released_at,
      already_imported: alreadyImportedRefs.has(rel.id),
      drawing_count: drawingCount,
    });
  }
  return proposals;
}
