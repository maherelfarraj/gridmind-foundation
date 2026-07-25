// P-043 — Opportunity detail route.
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";

import { ActivityTimeline } from "@/components/crm/detail/ActivityTimeline";
import { CompetitorIntelCard } from "@/components/crm/detail/CompetitorIntelCard";
import { ContactsCard } from "@/components/crm/detail/ContactsCard";
import { OpportunityHeaderCard } from "@/components/crm/detail/OpportunityHeaderCard";
import { TenderEventsCard } from "@/components/crm/detail/TenderEventsCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  activityQueryOptions,
  contactsQueryOptions,
  opportunityDetailQueryOptions,
  tenderEventsQueryOptions,
} from "@/lib/opportunity-query";
import {
  getOpportunity,
  getOpportunityActivity,
  listContacts,
  listTenderEvents,
} from "@/lib/opportunity.functions";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";

export const Route = createFileRoute("/_authenticated/crm/opportunities/$opportunityId")({
  head: () => ({
    meta: [
      { title: "Opportunity — GridMind CRM" },
      {
        name: "description",
        content:
          "Opportunity detail with contacts, competitor intel, tender events, and audit-driven activity.",
      },
      { property: "og:title", content: "Opportunity — GridMind CRM" },
      {
        property: "og:description",
        content:
          "Contacts, tender events, decision date, and full activity history for an EPC opportunity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context, params }) => {
    const fn = getOpportunity;
    const data = await context.queryClient.ensureQueryData({
      queryKey: ["crm", "opportunity", params.opportunityId],
      queryFn: () => fn({ data: { id: params.opportunityId } }),
      staleTime: 15_000,
    });
    if (!data) throw notFound();
    return { opportunityId: params.opportunityId };
  },
  errorComponent: DetailError,
  notFoundComponent: OpportunityNotFound,
  component: OpportunityDetailPage,
});

function OpportunityDetailPage() {
  const { opportunityId } = Route.useParams();

  const getOppFn = useServerFn(getOpportunity);
  const contactsFn = useServerFn(listContacts);
  const tendersFn = useServerFn(listTenderEvents);
  const activityFn = useServerFn(getOpportunityActivity);

  const oppQuery = useSuspenseQuery(opportunityDetailQueryOptions(getOppFn, opportunityId));
  const opp = oppQuery.data;

  const contactsQuery = useQuery(contactsQueryOptions(contactsFn, opportunityId));
  const tendersQuery = useQuery(tenderEventsQueryOptions(tendersFn, opportunityId));
  const activityQuery = useQuery(activityQueryOptions(activityFn, opportunityId));

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });
  const roles = new Set((rolesQuery.data ?? []).map((r) => r.role));
  const canWrite = roles.has("sales") || roles.has("company_admin") || roles.has("super_admin");
  const canDelete = roles.has("company_admin") || roles.has("super_admin");
  const readOnly = !canWrite;

  const [tenderOpenTrigger, setTenderOpenTrigger] = useState(0);

  if (!opp) return <OpportunityNotFound />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          to="/crm/pipeline"
          search={{ tab: "board" }}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to pipeline
        </Link>
      </div>

      <OpportunityHeaderCard
        opportunity={opp}
        readOnly={readOnly}
        onAddTenderEvent={() => setTenderOpenTrigger((n) => n + 1)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ActivityTimeline
            opportunityId={opportunityId}
            items={activityQuery.data}
            isLoading={activityQuery.isLoading}
            canWrite={canWrite}
          />
        </div>
        <div className="flex flex-col gap-4">
          <ContactsCard
            opportunityId={opportunityId}
            contacts={contactsQuery.data}
            isLoading={contactsQuery.isLoading}
            canWrite={canWrite}
            canDelete={canDelete}
          />
          <TenderEventsCard
            opportunityId={opportunityId}
            events={tendersQuery.data}
            isLoading={tendersQuery.isLoading}
            canWrite={canWrite}
            canDelete={canDelete}
            openTrigger={tenderOpenTrigger}
            onOpenConsumed={() => {
              /* trigger is one-shot; nothing to reset */
            }}
          />
          <CompetitorIntelCard opportunity={opp} readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl p-6">
      <Card className="flex w-full flex-col items-start gap-3 border-destructive/40 bg-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Couldn&rsquo;t load this opportunity
        </h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unexpected error."}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            <RefreshCw size={14} aria-hidden />
            Retry
          </Button>
          <Button asChild variant="outline">
            <Link to="/crm/pipeline" search={{ tab: "board" }}>
              <ArrowLeft size={14} aria-hidden />
              Back
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function OpportunityNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl p-6">
      <Card className="flex w-full flex-col items-start gap-3 border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Opportunity not available
        </h2>
        <p className="text-sm text-muted-foreground">
          This opportunity doesn&rsquo;t exist or you don&rsquo;t have access to it.
        </p>
        <Button asChild variant="outline">
          <Link to="/crm/pipeline" search={{ tab: "board" }}>
            <ArrowLeft size={14} aria-hidden />
            Back to pipeline
          </Link>
        </Button>
      </Card>
    </div>
  );
}
