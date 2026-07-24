// P-050 — Internal kick-off pack PDF builder (server-safe).
// Runs in server functions and browsers; uses only jspdf + jspdf-autotable.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";

export interface KickoffPdfInput {
  opportunity: any;
  intake: {
    id: string;
    name: string;
    archetype: string | null;
    capacity_mw: number | null;
    offtaker: string | null;
    target_cod: string | null;
  };
  contacts: Array<{
    full_name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    is_primary: boolean;
  }>;
  acceptedProposal: {
    id: string;
    version: number;
    status: string;
    subtotal: number | string | null;
    contingency_pct: number | string | null;
    total: number | string | null;
    currency_code: string | null;
    margin_pct: number | string | null;
    yield_result: any | null;
    created_at: string;
  } | null;
  tenderEvents: Array<{
    event_type: string;
    title: string | null;
    event_at: string;
    location: string | null;
    notes: string | null;
  }>;
  company: { name: string; legal_name?: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    footerText: string | null;
    logoSignedUrl: string | null;
  };
}

function sanitize(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&;/g, "&");
}

function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  const raw = m ? m[1] : DEFAULT_PRIMARY.slice(1);
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function fmtNum(n: unknown, digits = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(v);
}

function fmtMoney(n: unknown, currency: string): string {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
}

async function fetchLogoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    // btoa exists in both browsers and workerd.
    const base64 = typeof btoa === "function" ? btoa(bin) : "";
    if (!base64) return null;
    const ct = res.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function buildKickoffPdf(input: KickoffPdfInput): Promise<Blob> {
  const { opportunity: opp, intake, contacts, acceptedProposal, tenderEvents, company, branding } =
    input;
  const primary = hexToRgb(branding.primaryColor);
  const logoDataUrl = await fetchLogoDataUrl(branding.logoSignedUrl);
  const currency =
    (acceptedProposal?.currency_code as string | null) ||
    (opp.currency_code as string | null) ||
    "USD";

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  const footerLabel = sanitize(
    branding.footerText || company.legal_name || company.name || "GridMind",
  );

  const drawFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 40, 40);
      doc.text("INTERNAL — do not distribute", margin, pageH - 32);
      doc.setTextColor(120);
      doc.text(footerLabel, margin, pageH - 20);
      doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 20, {
        align: "right",
      });
    }
    doc.setTextColor(0);
  };

  // --- Cover / header band ---
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 90, "F");

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", margin, 20, 120, 50, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }

  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Kick-off Pack", pageW - margin, 45, { align: "right" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(sanitize(intake.name), pageW - margin, 65, { align: "right" });
  doc.setTextColor(0);

  let y = 120;

  // --- Opportunity summary ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Opportunity summary", margin, y);
  y += 6;

  const oppRows: Array<[string, string]> = [
    ["Opportunity", sanitize(opp.name)],
    ["Account", sanitize(opp.account_name ?? "—")],
    ["Archetype", sanitize(intake.archetype ?? opp.archetype ?? "—")],
    [
      "Capacity",
      intake.capacity_mw != null
        ? `${fmtNum(intake.capacity_mw, 2)} MW`
        : "—",
    ],
    ["Offtaker", sanitize(intake.offtaker ?? "—")],
    ["Target COD", fmtDate(intake.target_cod)],
    [
      "Estimated value",
      opp.estimated_value != null
        ? fmtMoney(opp.estimated_value, opp.currency_code || currency)
        : "—",
    ],
    ["Stage", "won"],
    ["Won at", fmtDate(opp.won_at)],
  ];

  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    body: oppRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // --- Margin snapshot (internal — margin allowed) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Margin snapshot (internal)", margin, y);
  y += 6;

  const marginPct = acceptedProposal?.margin_pct;
  const marginRows: Array<[string, string]> = [
    [
      "Accepted proposal",
      acceptedProposal
        ? `v${acceptedProposal.version} · ${acceptedProposal.status}`
        : "—",
    ],
    [
      "Total",
      acceptedProposal
        ? fmtMoney(acceptedProposal.total, currency)
        : "—",
    ],
    [
      "Subtotal",
      acceptedProposal
        ? fmtMoney(acceptedProposal.subtotal, currency)
        : "—",
    ],
    [
      "Contingency",
      acceptedProposal
        ? `${fmtNum(acceptedProposal.contingency_pct, 2)}%`
        : "—",
    ],
    [
      "Margin",
      marginPct != null && acceptedProposal
        ? `${fmtNum(marginPct, 2)}%`
        : "—",
    ],
  ];
  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    body: marginRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // --- Contacts ---
  if (y > pageH - 220) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Contacts", margin, y);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    head: [["Name", "Title", "Email", "Phone", "Primary"]],
    body: (contacts.length ? contacts : []).map((c) => [
      sanitize(c.full_name),
      sanitize(c.title ?? ""),
      sanitize(c.email ?? ""),
      sanitize(c.phone ?? ""),
      c.is_primary ? "Yes" : "",
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: primary, textColor: 255, fontStyle: "bold" },
  });
  if (!contacts.length) {
    y = (doc as any).lastAutoTable.finalY + 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("No contacts recorded.", margin, y + 8);
    doc.setTextColor(0);
    y += 14;
  } else {
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // --- Yield P50/P90 + monthly ---
  const yieldResult = acceptedProposal?.yield_result ?? null;
  if (y > pageH - 200) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Energy yield (P50 / P90)", margin, y);
  const yieldRows: Array<[string, string]> = [
    ["Engine", "gridmind-stub-v1 (placeholder)"],
    [
      "P50 energy (yr)",
      yieldResult?.p50_kwh != null
        ? `${fmtNum(yieldResult.p50_kwh, 0)} kWh`
        : "—",
    ],
    [
      "P90 energy (yr)",
      yieldResult?.p90_kwh != null
        ? `${fmtNum(yieldResult.p90_kwh, 0)} kWh`
        : "—",
    ],
    [
      "Specific yield",
      yieldResult?.specific_yield_kwh_kwp != null
        ? `${fmtNum(yieldResult.specific_yield_kwh_kwp, 0)} kWh/kWp`
        : "—",
    ],
    [
      "Performance ratio",
      yieldResult?.performance_ratio != null
        ? fmtNum(yieldResult.performance_ratio, 3)
        : "—",
    ],
  ];
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    body: yieldRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 160 } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  const monthly: number[] = Array.isArray(yieldResult?.monthly)
    ? yieldResult.monthly
    : [];
  if (monthly.length === 12) {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [months],
      body: [monthly.map((v) => fmtNum(v, 0))],
      styles: { fontSize: 8, halign: "right", cellPadding: 3 },
      headStyles: { fillColor: primary, textColor: 255, halign: "right" },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // --- Tender events ---
  if (y > pageH - 200) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Tender events", margin, y);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    head: [["When", "Type", "Title", "Location"]],
    body: (tenderEvents.length ? tenderEvents : []).map((t) => [
      fmtDate(t.event_at),
      sanitize(t.event_type.replaceAll("_", " ")),
      sanitize(t.title ?? ""),
      sanitize(t.location ?? ""),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: primary, textColor: 255, fontStyle: "bold" },
  });
  if (!tenderEvents.length) {
    y = (doc as any).lastAutoTable.finalY + 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("No tender events recorded.", margin, y + 8);
    doc.setTextColor(0);
    y += 14;
  } else {
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // --- Next steps checklist ---
  if (y > pageH - 180) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Next steps", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const checklist = [
    "Assign a project_admin owner in the People module",
    "Run the project wizard to create the delivery project (Batch 04)",
    "Schedule the internal kick-off meeting with engineering and procurement",
    "Confirm signed contract copy is filed in documents/",
    "Import PVsyst / SLD scenarios once site data lands",
  ];
  for (const item of checklist) {
    doc.text(`[  ]  ${sanitize(item)}`, margin, y);
    y += 16;
  }

  drawFooter();

  const blob = doc.output("blob");
  return blob;
}
