// P-056 — CSV parser for PVsyst summary exports (client-safe).
// Looks for header cells containing P50 / P90 / PR / Specific yield and the
// numeric value in an adjacent cell (same row).

export interface PvsystParsed {
  p50_mwh?: number;
  p90_mwh?: number;
  pr_pct?: number;
  specific_yield_kwh_kwp?: number;
}

function toNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[,\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function parsePvsystCsv(text: string): PvsystParsed {
  const out: PvsystParsed = {};
  const rows = text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((c) => c.trim()));

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const label = row[i]?.toLowerCase() ?? "";
      const nextValues = row.slice(i + 1).filter(Boolean);
      const first = nextValues[0] ?? "";
      const value = toNumber(first);
      if (value === undefined) continue;

      if (out.p50_mwh === undefined && /\bp\s?50\b/.test(label)) {
        out.p50_mwh = /gwh/.test(label) ? value * 1000 : value;
      } else if (out.p90_mwh === undefined && /\bp\s?90\b/.test(label)) {
        out.p90_mwh = /gwh/.test(label) ? value * 1000 : value;
      } else if (out.pr_pct === undefined && /(performance\s*ratio|^pr\b|\bpr\s*\()/.test(label)) {
        out.pr_pct = value > 1.5 ? value : value * 100;
      } else if (
        out.specific_yield_kwh_kwp === undefined &&
        /(specific\s*yield|kwh\s*\/\s*kwp)/.test(label)
      ) {
        out.specific_yield_kwh_kwp = value;
      }
    }
  }
  return out;
}
