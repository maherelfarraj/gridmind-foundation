// P-144 — Schedule PDF built on the shared export theme (branding hex allowed here only).
import {
  createDoc,
  createExportThemeSync,
  docTable,
  drawFooters,
  drawHeaderBand,
  downloadBlob,
  slugify,
  type ExportTheme,
} from "./theme";
import { scheduleMatrix, SCHEDULE_LABELS, type ScheduleType } from "@/lib/sld/schedules";

export type ScheduleBranding = {
  company_name?: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  footer_text: string | null;
};

export function buildSchedulePdf(args: {
  scheduleType: ScheduleType;
  rows: Record<string, unknown>[];
  drawing: { drawing_number: string; title: string; revision_code: string | null };
  branding: ScheduleBranding | null;
}): Blob {
  const theme: ExportTheme = createExportThemeSync(
    {
      primaryColor: args.branding?.primary_color ?? null,
      accentColor: args.branding?.accent_color ?? null,
      footerText: args.branding?.footer_text ?? null,
      logoDataUrl: null,
    },
    { name: args.branding?.company_name ?? null },
  );

  const doc = createDoc();
  const label = SCHEDULE_LABELS[args.scheduleType];
  const subtitle = [
    args.drawing.drawing_number,
    args.drawing.title,
    args.drawing.revision_code ? `Rev ${args.drawing.revision_code}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  let y = drawHeaderBand(doc, theme, label, subtitle);
  const { headers, body } = scheduleMatrix(args.scheduleType, args.rows);
  y = docTable(doc, theme, { startY: y, head: [headers], body });
  drawFooters(doc, theme);

  return doc.output("blob");
}

export function downloadSchedulePdf(
  filename: string,
  args: Parameters<typeof buildSchedulePdf>[0],
): void {
  downloadBlob(filename || `${slugify(args.drawing.drawing_number)}-schedule.pdf`, buildSchedulePdf(args));
}
