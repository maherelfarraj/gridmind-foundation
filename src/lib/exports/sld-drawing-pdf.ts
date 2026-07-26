// P-147 — Drawing PDF: the sheet SVG embedded in the shared branded template.
// Brand hex is allowed here only (the SVG itself stays token-neutral).
import { toPng } from "@/lib/sld/exporters";
import {
  createDoc,
  createExportThemeSync,
  downloadBlob,
  drawFooters,
  drawHeaderBand,
  mm,
  PAGE,
  slugify,
  type ExportTheme,
} from "./theme";

export type DrawingBranding = {
  company_name?: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  footer_text: string | null;
};

export type DrawingMeta = {
  drawing_number: string;
  title: string;
  revision_code: string | null;
};

/** Rasterizes the sheet SVG and places it on a branded landscape-ish page. */
export async function buildDrawingPdf(args: {
  svg: string;
  drawing: DrawingMeta;
  branding: DrawingBranding | null;
}): Promise<Blob> {
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
  const subtitle = [
    args.drawing.title,
    args.drawing.revision_code ? `Rev ${args.drawing.revision_code}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const y = drawHeaderBand(doc, theme, args.drawing.drawing_number, subtitle);

  const png = await toPng(args.svg, 2);
  const dataUrl = await blobToDataUrl(png);
  const image = await loadImage(dataUrl);

  const maxW = doc.internal.pageSize.getWidth() - mm(PAGE.margin) * 2;
  const maxH = doc.internal.pageSize.getHeight() - y - mm(PAGE.margin);
  const ratio = image.height / image.width || 0.7;
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  doc.addImage(dataUrl, "PNG", mm(PAGE.margin), y, w, h);
  drawFooters(doc, theme);
  return doc.output("blob");
}

export async function downloadDrawingPdf(
  filename: string,
  args: Parameters<typeof buildDrawingPdf>[0],
): Promise<void> {
  downloadBlob(
    filename || `${slugify(args.drawing.drawing_number)}.pdf`,
    await buildDrawingPdf(args),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the rendered image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the rendered image"));
    img.src = src;
  });
}
