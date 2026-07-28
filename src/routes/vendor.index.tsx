// P-222 — Vendor portal membership picker.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Building2, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { listMyVendorMemberships } from "@/lib/vendor-portal.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/vendor/")({
  head: () => ({
    meta: [
      { title: "Your vendor accounts — GridMind Vendor Portal" },
      {
        name: "description",
        content: "Choose the vendor account you want to open in the GridMind vendor portal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorIndex,
});

function statusVariant(status: string) {
  if (status === "active") return "default" as const;
  if (status === "invited") return "secondary" as const;
  return "outline" as const;
}

function VendorIndex() {
  const { t } = useI18n();
  const listFn = useServerFn(listMyVendorMemberships);
  const q = useQuery({
    queryKey: ["vendor-portal", "memberships"],
    queryFn: () => listFn(),
  });

  return (
    <div className="page-shell mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title={t("portalMod.accountPicker.title")}
        description={t("portalMod.accountPicker.description")}
      />

      {q.isLoading ? (
        <VendorTableSkeleton />
      ) : q.error ? (
        <VendorStateCard
          title={t("portalMod.accountPicker.loadErrorTitle")}
          description={t("portalMod.accountPicker.loadErrorDesc")}
          onRetry={() => void q.refetch()}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("portalMod.accountPicker.emptyTitle")}
          description={t("portalMod.accountPicker.emptyDesc")}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(q.data ?? []).map((m) => {
            const inner = (
              <>
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {m.vendor_name ?? t("portalMod.accountPicker.vendorFallback")}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {m.company_name ?? "—"}
                  </div>
                  {m.last_seen_at ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("portalMod.accountPicker.lastOpened", {
                        time: formatDistanceToNow(new Date(m.last_seen_at), { addSuffix: true }),
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(m.status)} className="capitalize">
                    {t(`portalMod.accountPicker.status.${m.status}`)}
                  </Badge>
                  {m.status === "active" ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : null}
                </div>
              </>
            );

            return (
              <li key={m.id}>
                {m.status === "active" ? (
                  <Link
                    to="/vendor/$vendorId"
                    params={{ vendorId: m.vendor_id }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/50"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 opacity-70">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
