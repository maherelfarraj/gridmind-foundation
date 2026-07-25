// P-050 — Internal kick-off pack PDF builder (server-safe), on the shared export theme.
// Runs in server functions and browsers; uses only jspdf + jspdf-autotable.

import {
  createDoc,
  createExportTheme,
  drawHeaderBand,
  drawFooters,
  docH2,
  ensureSpace,
  docTable,
  numericCol,
  tableEndY,
  sanitize,
  fmtNum,
  fmtMoney,
  fmtDate,
  PAGE,
  mm,
  NEUTRAL,
} from "@/lib/exports/theme";

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

const DOC_TITLE = "Kick-off Pack";

export async function buildKickoffPdf(input: KickoffPdfInput): Promise<Blob> {
  const {
    opportunity: opp,
    intake,
    contacts,
    acceptedProposal,
    tenderEvents,
    company,
    branding,
  } = input;

  const theme = await createExportTheme(
    {
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      footerText: branding.footerText || "INTERNAL — do not distribute",
      logoSignedUrl: branding.logoSignedUrl,
    },
    company,
  );

  const currency =
    (acceptedProposal?.currency_code as string | null) ||
    (opp.currency_code as string | null) ||
    "USD";

  const doc = createDoc();
  const docSubtitle = sanitize(intake.name);
  const pageHeader = { title: DOC_TITLE, subtitle: docSubtitle };
  let y = drawHeaderBand(doc, theme, DOC_TITLE, docSubtitle);

  // --- Opportunity summary ---
  y = docH2(doc, theme, "Opportunity summary", y);
  const oppRows: Array<[string, string]> = [
    ["Opportunity", sanitize(opp.name)],
    ["Account", sanitize(opp.account_name ?? "—")],
    ["Archetype", sanitize(intake.archetype ?? opp.archetype ?? "—")],
    ["Capacity", intake.capacity_mw != null ? `${fmtNum(intake.capacity_mw, 2)} MW` : "—"],
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
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 4, textColor: NEUTRAL.body as never },
      body: oppRows,
      columnStyles: { 0: { fontStyle: "bold", cellWidth: mm(53) } },
    }) + mm(6);

  // --- Margin snapshot (internal — margin allowed on this internal-only doc) ---
  y = ensureSpace(doc, theme, y, mm(45), DOC_TITLE);
  y = docH2(doc, theme, "Margin snapshot (internal)", y);
  const marginPct = acceptedProposal?.margin_pct;
  const marginRows: Array<[string, string]> = [
    [
      "Accepted proposal",
      acceptedProposal ? `v${acceptedProposal.version} · ${acceptedProposal.status}` : "—",
    ],
    ["Total", acceptedProposal ? fmtMoney(acceptedProposal.total, currency) : "—"],
    ["Subtotal", acceptedProposal ? fmtMoney(acceptedProposal.subtotal, currency) : "—"],
    ["Contingency", acceptedProposal ? `${fmtNum(acceptedProposal.contingency_pct, 2)}%` : "—"],
    ["Margin", marginPct != null && acceptedProposal ? `${fmtNum(marginPct, 2)}%` : "—"],
  ];
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 4, textColor: NEUTRAL.body as never },
      body: marginRows,
      columnStyles: { 0: { fontStyle: "bold", cellWidth: mm(53) } },
    }) + mm(6);

  // --- Contacts ---
  y = ensureSpace(doc, theme, y, mm(60), DOC_TITLE);
  y = docH2(doc, theme, "Contacts", y);
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [["Name", "Title", "Email", "Phone", "Primary"]],
      body: contacts.length
        ? contacts.map((c) => [
            sanitize(c.full_name),
            sanitize(c.title ?? ""),
            sanitize(c.email ?? ""),
            sanitize(c.phone ?? ""),
            c.is_primary ? "Yes" : "",
          ])
        : [["—", "—", "—", "—", "No contacts recorded"]],
    }) + mm(6);

  // --- Yield P50/P90 + monthly ---
  const yieldResult = acceptedProposal?.yield_result ?? null;
  y = ensureSpace(doc, theme, y, mm(60), DOC_TITLE);
  y = docH2(doc, theme, "Energy yield (P50 / P90)", y);
  const yieldRows: Array<[string, string]> = [
    ["Engine", "gridmind-stub-v1 (placeholder)"],
    [
      "P50 energy (yr)",
      yieldResult?.p50_kwh != null ? `${fmtNum(yieldResult.p50_kwh, 0)} kWh` : "—",
    ],
    [
      "P90 energy (yr)",
      yieldResult?.p90_kwh != null ? `${fmtNum(yieldResult.p90_kwh, 0)} kWh` : "—",
    ],
    [
      "Specific yield",
      yieldResult?.specific_yield_kwh_kwp != null
        ? `${fmtNum(yieldResult.specific_yield_kwh_kwp, 0)} kWh/kWp`
        : "—",
    ],
    [
      "Performance ratio",
      yieldResult?.performance_ratio != null ? fmtNum(yieldResult.performance_ratio, 3) : "—",
    ],
  ];
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 4, textColor: NEUTRAL.body as never },
      body: yieldRows,
      columnStyles: { 0: { fontStyle: "bold", cellWidth: mm(56) } },
    }) + mm(3);

  const monthly: number[] = Array.isArray(yieldResult?.monthly) ? yieldResult.monthly : [];
  if (monthly.length === 12) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    y = ensureSpace(doc, theme, y, mm(20), DOC_TITLE);
    y =
      docTable(doc, theme, {
        startY: y,
        pageHeader,
        head: [months],
        body: [monthly.map((v) => fmtNum(v, 0))],
        styles: { fontSize: 8, halign: "right", cellPadding: 3 },
      }) + mm(6);
  }

  // --- Tender events ---
  y = ensureSpace(doc, theme, y, mm(60), DOC_TITLE);
  y = docH2(doc, theme, "Tender events", y);
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [["When", "Type", "Title", "Location"]],
      body: tenderEvents.length
        ? tenderEvents.map((t) => [
            fmtDate(t.event_at),
            sanitize(t.event_type.replaceAll("_", " ")),
            sanitize(t.title ?? ""),
            sanitize(t.location ?? ""),
          ])
        : [["—", "—", "No tender events recorded", "—"]],
    }) + mm(6);

  // --- Next steps checklist ---
  y = ensureSpace(doc, theme, y, mm(55), DOC_TITLE);
  y = docH2(doc, theme, "Next steps", y);
  const checklist = [
    "Assign a project_admin owner in the People module",
    "Run the project wizard to create the delivery project (Batch 04)",
    "Schedule the internal kick-off meeting with engineering and procurement",
    "Confirm signed contract copy is filed in documents/",
    "Import PVsyst / SLD scenarios once site data lands",
  ];
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 3, textColor: NEUTRAL.body as never },
      body: checklist.map((item) => [`[  ]  ${sanitize(item)}`]),
    }) + mm(4);

  drawFooters(doc, theme);

  return doc.output("blob");
}
