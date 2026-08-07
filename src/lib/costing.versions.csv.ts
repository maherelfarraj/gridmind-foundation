// GC-03 — CSV export for frozen forecast-version snapshots and comparisons.
// Pure string building: no re-rating, no rounding beyond 2dp presentation.
import { toCsv } from "@/lib/csv";
import type {
  ForecastDiff,
  ForecastSnapshotLine,
  ForecastSnapshotTotals,
} from "@/lib/costing.versions";

const money = (n: number | null | undefined) => (n == null ? "" : Number(n).toFixed(2));

export interface ForecastVersionCsvHeader {
  version_no: number;
  status: string;
  reporting_period: string;
  base_currency_code: string;
  project_name?: string | null;
  approved_at?: string | null;
}

/** One row per snapshot line, with the frozen header echoed as a comment-free prefix column set. */
export function buildForecastVersionCsv(
  header: ForecastVersionCsvHeader,
  lines: readonly ForecastSnapshotLine[],
  totals?: ForecastSnapshotTotals | null,
): string {
  const headers = [
    "version_no",
    "status",
    "reporting_period",
    "cost_code",
    "cost_code_name",
    "currency_code",
    "fx_rate",
    "fx_rate_date",
    "fx_source",
    "base_currency_code",
    "budget_current",
    "committed",
    "actual",
    "accruals",
    "etc",
    "eac",
    "vac",
  ];
  const rows: unknown[][] = lines.map((l) => [
    header.version_no,
    header.status,
    header.reporting_period.slice(0, 7),
    l.cost_code ?? "Unassigned",
    l.cost_code_name ?? "",
    l.currency_code,
    l.fx_rate,
    l.fx_rate_date ?? "",
    l.fx_source,
    l.base_currency_code,
    money(l.budget_current),
    money(l.committed),
    money(l.actual),
    money(l.accruals),
    money(l.etc_amount_base),
    money(l.eac),
    money(l.vac),
  ]);

  if (totals) {
    rows.push([
      header.version_no,
      header.status,
      header.reporting_period.slice(0, 7),
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      totals.base_currency_code,
      money(totals.budget_current),
      money(totals.committed),
      money(totals.actual),
      money(totals.accruals),
      money(totals.etc),
      money(totals.eac),
      money(totals.vac),
    ]);
  }
  return toCsv(headers, rows);
}

/** One row per compared cost code, with the ordered EAC drivers flattened. */
export function buildForecastCompareCsv(
  fromLabel: string,
  toLabel: string,
  diff: ForecastDiff,
): string {
  const headers = [
    "from_version",
    "to_version",
    "cost_code",
    "cost_code_name",
    "kind",
    "from_etc",
    "to_etc",
    "delta_etc",
    "from_eac",
    "to_eac",
    "delta_eac",
    "drivers",
  ];
  const rows: unknown[][] = diff.rows.map((r) => [
    fromLabel,
    toLabel,
    r.cost_code ?? "Unassigned",
    r.cost_code_name ?? "",
    r.kind,
    money(r.from?.etc ?? null),
    money(r.to?.etc ?? null),
    money(r.delta_etc),
    money(r.from?.eac ?? null),
    money(r.to?.eac ?? null),
    money(r.delta_eac),
    r.drivers.map((d) => `${d.key}:${d.delta.toFixed(2)}`).join(" | "),
  ]);
  rows.push([
    fromLabel,
    toLabel,
    "TOTAL",
    "",
    "",
    "",
    "",
    money(diff.totals.delta_etc),
    "",
    "",
    money(diff.totals.delta_eac),
    "",
  ]);
  return toCsv(headers, rows);
}

export function forecastVersionCsvFilename(header: ForecastVersionCsvHeader): string {
  const project = (header.project_name ?? "forecast")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${project}-forecast-v${header.version_no}-${header.reporting_period.slice(0, 7)}.csv`;
}
