// P-097 — Commissioning certificate PDF (client-side jsPDF, branded).
//
// Ampersands ("O&M team", "Owens & Minor Solar") render literally via the
// shared theme's sanitize().
import {
  createDoc,
  createExportThemeSync,
  drawHeaderBand,
  drawFooters,
  docTable,
  ensureSpace,
  fmtDate,
  fmtPct,
  sanitize,
  PAGE,
  FONT,
  NEUTRAL,
  mm,
  contentWidth,
  type ExportTheme,
} from "@/lib/exports/theme";

import {
  CERT_PARTY_LABELS,
  CERT_TYPE_LABELS,
  type CertificateType,
  type CertSignature,
} from "@/lib/commissioning-certificates.rules";

export { sanitize };

export interface SignatureImage extends CertSignature {
  imageDataUrl: string | null;
}

export interface CertificatePdfInput {
  type: CertificateType;
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoDataUrl: string | null;
  };
  certificateNumber: string;
  effectiveDate: string | null;
  scopeNotes: string;
  punchSummary: Record<"A" | "B" | "C", { open: number; closed: number }> | null;
  prAtCod: number | null;
  signatures: SignatureImage[];
  generatedAt: string;
}

export function buildCertificatePdfBytes(input: CertificatePdfInput): Uint8Array {
  const theme: ExportTheme = createExportThemeSync(
    {
      primaryColor: input.branding.primaryColor,
      accentColor: input.branding.accentColor,
      logoDataUrl: input.branding.logoDataUrl,
      footerText: `${input.company.name} • ${input.certificateNumber}`,
    },
    { name: input.company.name, legal_name: input.company.legalName },
  );

  const doc = createDoc();
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = PAGE.margin;

  const docTitle = `Certificate — ${input.project.name}`;
  const docSubtitle = `Generated ${fmtDate(input.generatedAt)}`;
  const pageHeader = { title: docTitle, subtitle: docSubtitle };
  let y = drawHeaderBand(doc, theme, docTitle, docSubtitle);

  doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const title = `CERTIFICATE OF ${CERT_TYPE_LABELS[input.type].toUpperCase()}`;
  doc.text(sanitize(title), pageW / 2, y, { align: "center" });
  y += 12;
  doc.setDrawColor(theme.accent[0], theme.accent[1], theme.accent[2]);
  doc.setLineWidth(1);
  doc.line(pageW / 2 - 80, y, pageW / 2 + 80, y);
  y += 24;

  // Meta grid
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
  const metaRows: [string, string][] = [
    ["Certificate No.", sanitize(input.certificateNumber)],
    [
      "Project",
      sanitize(`${input.project.name}${input.project.code ? ` (${input.project.code})` : ""}`),
    ],
    ["Effective Date", fmtDate(input.effectiveDate)],
  ];
  for (const [k, v] of metaRows) {
    doc.setFont("helvetica", "bold");
    doc.text(k, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, marginX + 120, y);
    y += 16;
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.text("Scope & Notes", marginX, y);
  doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
  const scope = sanitize(input.scopeNotes || "—");
  const scopeLines = doc.splitTextToSize(scope, contentWidth(doc));
  doc.text(scopeLines, marginX, y);
  y += scopeLines.length * 12 + 8;

  if (input.type === "cod") {
    if (input.punchSummary) {
      y = ensureSpace(doc, theme, y, 100, `Certificate — ${input.project.name}`);
      y =
        docTable(doc, theme, {
          startY: y,
          pageHeader,
          head: [["Punch Category", "Open", "Closed"]],
          body: (["A", "B", "C"] as const).map((c) => [
            `Category ${c}`,
            String(input.punchSummary![c].open),
            String(input.punchSummary![c].closed),
          ]),
        }) + 12;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Performance Ratio at COD:", marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(fmtPct(input.prAtCod, 2), marginX + 180, y);
    y += 16;
  }

  y += 10;
  y = ensureSpace(doc, theme, y, 40, `Certificate — ${input.project.name}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.text("Signatures", marginX, y);
  doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
  y += 12;

  // Signature blocks: 2 per row.
  const blockW = (contentWidth(doc) - 24) / 2;
  const blockH = 96;
  let col = 0;
  for (const s of input.signatures) {
    if (col === 0) {
      y = ensureSpace(doc, theme, y, blockH, `Certificate — ${input.project.name}`);
    }
    const x = marginX + col * (blockW + 24);
    doc.setDrawColor(NEUTRAL.line[0], NEUTRAL.line[1], NEUTRAL.line[2]);
    doc.setLineWidth(0.5);
    doc.rect(x, y, blockW, blockH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
    doc.text(sanitize(CERT_PARTY_LABELS[s.party]), x + 8, y + 14);
    if (s.imageDataUrl) {
      try {
        doc.addImage(s.imageDataUrl, "PNG", x + 8, y + 20, blockW - 16, 40);
      } catch {
        /* ignore */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(sanitize(s.name), x + 8, y + 74);
    doc.text(sanitize(s.title), x + 8, y + 86);
    doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
    doc.setFontSize(8);
    doc.text(fmtDate(s.signed_at), x + blockW - 8, y + 86, { align: "right" });
    doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);

    col += 1;
    if (col === 2) {
      col = 0;
      y += blockH + 12;
    }
  }
  if (col !== 0) y += blockH + 12;

  drawFooters(doc, theme);

  const out = doc.output("arraybuffer");
  return new Uint8Array(out as ArrayBuffer);
}
