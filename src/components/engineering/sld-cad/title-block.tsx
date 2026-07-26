// P-138 — Sheet border + title block, rendered from the drawing record.
import { SHEET_SIZES, type SheetSize } from "@/lib/sld/canvas-types";

export type TitleBlockData = {
  drawing_number: string;
  title: string;
  revision_code: string | null;
  status: string;
  project_name: string | null;
  drawn_by: string | null;
  date: string;
  sheet_size: SheetSize;
  border_template: string;
};

const CELL_H = 8;

export function SheetBorder({ data }: { data: TitleBlockData }) {
  const sheet = SHEET_SIZES[data.sheet_size] ?? SHEET_SIZES.A1;
  const m = 10;
  const tbW = 150;
  const tbH = CELL_H * 6;
  const tbX = sheet.w - m - tbW;
  const tbY = sheet.h - m - tbH;

  const rows: Array<[string, string]> = [
    ["Drawing no.", data.drawing_number],
    ["Title", data.title],
    ["Revision", data.revision_code ?? "—"],
    ["Status", data.status.replace(/_/g, " ")],
    ["Project", data.project_name ?? "—"],
    ["Drawn by / date", `${data.drawn_by ?? "—"}  ·  ${data.date}`],
  ];

  return (
    <g data-testid="sld-title-block" className="pointer-events-none">
      <rect
        x={0}
        y={0}
        width={sheet.w}
        height={sheet.h}
        className="fill-card stroke-border"
        strokeWidth={0.4}
      />
      <rect
        x={m}
        y={m}
        width={sheet.w - m * 2}
        height={sheet.h - m * 2}
        className="fill-none stroke-border"
        strokeWidth={0.6}
      />
      <rect
        x={tbX}
        y={tbY}
        width={tbW}
        height={tbH}
        className="fill-muted/40 stroke-border"
        strokeWidth={0.6}
      />
      {rows.map(([label, value], i) => (
        <g key={label}>
          <line
            x1={tbX}
            y1={tbY + i * CELL_H}
            x2={tbX + tbW}
            y2={tbY + i * CELL_H}
            className="stroke-border"
            strokeWidth={0.3}
          />
          <line
            x1={tbX + 42}
            y1={tbY + i * CELL_H}
            x2={tbX + 42}
            y2={tbY + (i + 1) * CELL_H}
            className="stroke-border"
            strokeWidth={0.3}
          />
          <text
            x={tbX + 2}
            y={tbY + i * CELL_H + 5.4}
            className="fill-muted-foreground"
            style={{ fontSize: 3.2 }}
          >
            {label}
          </text>
          <text
            x={tbX + 44}
            y={tbY + i * CELL_H + 5.4}
            className="fill-foreground"
            style={{ fontSize: 3.6, fontWeight: 600 }}
          >
            {value.length > 40 ? `${value.slice(0, 39)}…` : value}
          </text>
        </g>
      ))}
      <text
        x={tbX + 2}
        y={tbY - 2.5}
        className="fill-muted-foreground"
        style={{ fontSize: 3.2, letterSpacing: 0.4 }}
      >
        GRIDMIND EPC · {data.border_template} · {data.sheet_size}
      </text>
    </g>
  );
}
