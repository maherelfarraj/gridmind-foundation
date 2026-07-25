import { createFileRoute } from "@tanstack/react-router";

import { useActiveCompany } from "@/components/company-switcher";
import { ModuleAccessTable } from "@/components/module-access-table";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/settings/modules")({
  head: () => ({
    meta: [
      { title: "Module access — GridMind EPC" },
      {
        name: "description",
        content: "Read-only view of the modules enabled for your GridMind EPC tenant.",
      },
      { property: "og:title", content: "Module access — GridMind EPC" },
      {
        property: "og:description",
        content: "Read-only view of the modules enabled for your GridMind EPC tenant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsModulesPage,
});

function SettingsModulesPage() {
  const { activeCompanyId } = useActiveCompany();
  return (
    <div className="page-shell max-w-5xl">
      <PageHeader
        title="Module access"
        description="Modules enabled for your tenant — contact support to request an adjustment."
      />
      {activeCompanyId ? (
        <ModuleAccessTable companyId={activeCompanyId} canEdit={false} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading company…</p>
      )}
    </div>
  );
}
