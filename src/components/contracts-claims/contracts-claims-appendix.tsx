// GC-16 — Contract & claims appendix embedded in the project close pack and
// the portfolio management pack. Read-only governed evidence: exposure
// totals, waterfall, top claims, upcoming contractual deadlines, open alerts
// and reconciliation, with the non-posting watermark.
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { ClaimsAppendix, PortfolioClaimsView } from "@/lib/contracts-claims.server";

const K = "financeMod.costing.contractsClaims";

function money(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function ContractsClaimsAppendixCard({
  appendix,
  currency = "USD",
}: {
  appendix: ClaimsAppendix;
  currency?: string;
}) {
  const { t } = useI18n();
  const totals = appendix.totals;
  const failed = appendix.checks.filter((c) => !c.ok);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.appendix.description`)}</p>
        </div>
        <StatusBadge
          status={appendix.status === "approved" ? "approved" : "draft"}
          label={t(`${K}.status.${appendix.status}`)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t(`${K}.totals.asserted`)} value={money(totals.asserted, currency)} />
        <Field label={t(`${K}.totals.approved`)} value={money(totals.approved, currency)} />
        <Field label={t(`${K}.totals.certified`)} value={money(totals.certified, currency)} />
        <Field
          label={t(`${K}.totals.liveExposure`)}
          value={money(totals.live_exposure, currency)}
        />
        <Field
          label={t(`${K}.totals.unapproved`)}
          value={money(totals.unapproved_exposure, currency)}
        />
        <Field label={t(`${K}.totals.ld`)} value={money(totals.ld_exposure, currency)} />
        <Field label={t(`${K}.totals.eot`)} value={`${totals.eot_days_approved}`} />
        <Field label={t(`${K}.totals.claims`)} value={`${totals.claim_count}`} />
      </div>

      <section aria-labelledby="cc-appendix-waterfall">
        <h3 id="cc-appendix-waterfall" className="mb-2 text-xs font-semibold text-foreground">
          {t(`${K}.appendix.waterfall`)}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.appendix.step`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.appendix.movement`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.appendix.cumulative`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appendix.waterfall.map((s) => (
              <TableRow key={s.key}>
                <TableCell>{s.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(s.value, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(s.cumulative, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="cc-appendix-claims">
        <h3 id="cc-appendix-claims" className="mb-2 text-xs font-semibold text-foreground">
          {t(`${K}.appendix.topClaims`)}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.table.ref`)}</TableHead>
              <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.totals.approved`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.totals.liveExposure`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appendix.top_claims.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  {t(`${K}.empty.claims`)}
                </TableCell>
              </TableRow>
            ) : (
              appendix.top_claims.map((c) => (
                <TableRow key={c.claim_ref}>
                  <TableCell>
                    <span className="font-medium">{c.claim_ref}</span>{" "}
                    <span className="text-muted-foreground">{c.title}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} label={t(`${K}.claimStatus.${c.status}`)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(c.approved_amount, c.currency_code)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(c.exposure, c.currency_code)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="cc-appendix-deadlines">
        <h3 id="cc-appendix-deadlines" className="mb-2 text-xs font-semibold text-foreground">
          {t(`${K}.appendix.deadlines`)}
        </h3>
        {appendix.upcoming_deadlines.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(`${K}.empty.deadlines`)}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {appendix.upcoming_deadlines.map((d) => (
              <li key={`${d.label}-${d.due_date}`} className="flex justify-between gap-2">
                <span className="text-foreground">{d.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.due_date} · {d.days}d
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {failed.length > 0 ? (
        <section aria-labelledby="cc-appendix-recon">
          <h3 id="cc-appendix-recon" className="mb-2 text-xs font-semibold text-foreground">
            {t(`${K}.appendix.reconciliation`)}
          </h3>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {failed.map((c) => (
              <li key={c.code} className="tabular-nums">
                {c.code}: {money(c.expected, currency)} → {money(c.actual, currency)} (
                {money(c.delta, currency)})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">{appendix.disclaimer}</p>
    </Card>
  );
}

/** GC-16 — consolidated contract & claims appendix for the portfolio pack. */
export function PortfolioClaimsAppendixCard({
  data,
  currency = "USD",
}: {
  data: PortfolioClaimsView;
  currency?: string;
}) {
  const { t } = useI18n();
  const P = "portfolioMod.costing.contractsClaims";
  const totals = data.totals;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${P}.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${P}.subtitle`)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t(`${P}.kpi.liveExposure`)} value={money(totals.live_exposure, currency)} />
        <Field label={t(`${P}.kpi.approved`)} value={money(totals.approved, currency)} />
        <Field
          label={t(`${P}.kpi.unapproved`)}
          value={money(totals.unapproved_exposure, currency)}
        />
        <Field label={t(`${P}.kpi.ld`)} value={money(totals.ld_exposure, currency)} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${P}.table.project`)}</TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${P}.table.approved`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${P}.table.exposure`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${P}.table.overdue`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.projects.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                {t(`${P}.empty.title`)}
              </TableCell>
            </TableRow>
          ) : (
            data.projects.map((p) => (
              <TableRow key={p.project_id}>
                <TableCell>{p.project_name}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(p.totals.approved, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(p.totals.live_exposure, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">{p.overdue_deadlines}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </Card>
  );
}
