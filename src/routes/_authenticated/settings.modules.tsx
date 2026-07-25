import { createFileRoute } from "@tanstack/react-router";

import { useActiveCompany } from "@/components/company-switcher";
import { ModuleAccessTable } from "@/components/module-access-table";

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Module access
        </h1>
        <p className="text-sm text-muted-foreground">
          These are the GridMind EPC modules enabled for your tenant. Only a platform super admin
          can change them — contact support to request an adjustment.
        </p>
      </div>
      {activeCompanyId ? (
        <ModuleAccessTable companyId={activeCompanyId} canEdit={false} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading company…</p>
      )}
    </div>
  );
}
