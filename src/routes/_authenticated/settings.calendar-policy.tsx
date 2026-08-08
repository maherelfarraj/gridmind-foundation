// GC-16d — Company-level governed calendar policy + observed holiday sets.
// Read-and-govern surface: all authorisation, segregation and immutability is
// enforced server-side; this route only primes the cache and renders the
// governed administration component. NON-POSTING.
import { createFileRoute } from "@tanstack/react-router";

import { CalendarPolicyAdmin } from "@/components/contracts-claims/calendar-policy-admin";
import { PageHeader } from "@/components/ui/page-header";
import { calendarGovernanceQueryOptions } from "@/lib/calendar-governance.query";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/settings/calendar-policy")({
  loader: ({ context }) => context.queryClient.ensureQueryData(calendarGovernanceQueryOptions()),
  head: () => ({
    meta: [
      { title: "Calendar policy — GridMind EPC" },
      {
        name: "description",
        content:
          "Govern the company default deadline calendar, timezone and versioned observed-holiday sets used by contractual deadline calculation.",
      },
      { property: "og:title", content: "Calendar policy — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Company default calendar, effective resolution, impact preview and approved observed-holiday set versions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  notFoundComponent: CalendarPolicyMissing,
  component: CalendarPolicySettings,
});

function CalendarPolicyMissing() {
  const { t } = useI18n();
  return <div className="p-6 text-sm">{t("financeMod.costing.calendarPolicy.empty.changes")}</div>;
}

function CalendarPolicySettings() {
  const { t } = useI18n();
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title={t("financeMod.costing.calendarPolicy.title")}
        description={t("financeMod.costing.calendarPolicy.subtitle")}
      />
      <CalendarPolicyAdmin scope="company" showHolidaySets />
    </div>
  );
}
