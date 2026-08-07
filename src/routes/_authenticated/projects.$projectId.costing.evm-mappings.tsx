// GC-12 — EVM mapping & progress override governance workspace.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EvmMappingEditor, type MappingDraft } from "@/components/evm/evm-mapping-editor";
import { EvmOverridePanel, type OverrideDraft } from "@/components/evm/evm-override-panel";
import { costingErrorMessage } from "@/lib/costing.query";
import {
  approveEvmMappingVersion,
  createEvmMappingVersion,
  deleteEvmMapping,
  deleteEvmOverride,
  saveEvmMapping,
  saveEvmOverride,
} from "@/lib/evm.report.functions";
import {
  evmMappingsQueryOptions,
  evmMappingVersionsQueryOptions,
  evmOverridesQueryOptions,
  evmScopeCatalogQueryOptions,
  evmWorkspaceQueryOptions,
} from "@/lib/evm.report.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

const searchSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
});

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/evm-mappings")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(evmWorkspaceQueryOptions(params.projectId, deps.period)),
  head: () => ({
    meta: [
      { title: "EVM mapping & overrides — GridMind EPC" },
      {
        name: "description",
        content:
          "Version the WBS to cost-code mapping, reconcile allocations to 100% and govern manual progress overrides with evidence.",
      },
      { property: "og:title", content: "EVM mapping & overrides — GridMind EPC" },
      {
        property: "og:description",
        content: "Governed earned value mapping versions and authorised progress overrides.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  errorComponent: ({ error }) => (
    <Card className="p-6 text-sm text-destructive">{costingErrorMessage(error)}</Card>
  ),
  component: EvmMappingWorkspace,
});

function EvmMappingWorkspace() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const qc = useQueryClient();

  const workspace = useSuspenseQuery(evmWorkspaceQueryOptions(projectId, search.period));
  const period = workspace.data.computed.period_month;
  const canWrite = workspace.data.can_write;

  const versions = useSuspenseQuery(evmMappingVersionsQueryOptions(projectId));
  const catalog = useSuspenseQuery(evmScopeCatalogQueryOptions(projectId));
  const overrides = useQuery(evmOverridesQueryOptions(projectId, period));

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const activeVersionId =
    selectedVersionId ??
    versions.data.find((v) => v.status === "draft")?.id ??
    versions.data.find((v) => v.status === "approved")?.id ??
    null;

  const mappings = useQuery(evmMappingsQueryOptions(activeVersionId));

  const createVersionFn = useServerFn(createEvmMappingVersion);
  const approveVersionFn = useServerFn(approveEvmMappingVersion);
  const saveMappingFn = useServerFn(saveEvmMapping);
  const deleteMappingFn = useServerFn(deleteEvmMapping);
  const saveOverrideFn = useServerFn(saveEvmOverride);
  const deleteOverrideFn = useServerFn(deleteEvmOverride);

  const refreshMappings = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["evm", "mapping-versions", projectId] }),
      qc.invalidateQueries({ queryKey: ["evm", "mappings"] }),
      qc.invalidateQueries({ queryKey: ["evm", "workspace", projectId] }),
    ]);
  };
  const refreshOverrides = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["evm", "overrides", projectId, period] }),
      qc.invalidateQueries({ queryKey: ["evm", "workspace", projectId] }),
    ]);
  };
  const fail = (e: unknown) => toast.error(costingErrorMessage(e));

  const createVersion = useMutation({
    mutationFn: () => createVersionFn({ data: { project_id: projectId } }),
    onSuccess: async (res) => {
      setSelectedVersionId(res.id);
      toast.success(t(`${K}.mapping.versionCreated`));
      await refreshMappings();
    },
    onError: fail,
  });

  const approveVersion = useMutation({
    mutationFn: (id: string) => approveVersionFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t(`${K}.mapping.versionApproved`));
      await refreshMappings();
    },
    onError: fail,
  });

  const saveMapping = useMutation({
    mutationFn: (draft: MappingDraft) =>
      saveMappingFn({
        data: {
          mapping_version_id: activeVersionId as string,
          ...(draft.id ? { id: draft.id } : {}),
          wbs_item_id: draft.wbs_item_id,
          schedule_task_id: draft.schedule_task_id,
          cost_code_id: draft.cost_code_id,
          allocation_pct: draft.allocation_pct,
          progress_method: draft.progress_method,
          planned_units: draft.planned_units,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.mapping.savedToast`));
      await refreshMappings();
    },
    onError: fail,
  });

  const removeMapping = useMutation({
    mutationFn: (id: string) => deleteMappingFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t(`${K}.mapping.deletedToast`));
      await refreshMappings();
    },
    onError: fail,
  });

  const saveOverride = useMutation({
    mutationFn: (draft: OverrideDraft) =>
      saveOverrideFn({
        data: {
          project_id: projectId,
          period,
          wbs_item_id: draft.wbs_item_id,
          schedule_task_id: draft.schedule_task_id,
          override_pct: draft.override_pct,
          calculated_pct: draft.calculated_pct,
          reason: draft.reason,
          evidence_ref: draft.evidence_ref,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.mapping.savedToast`));
      await refreshOverrides();
    },
    onError: fail,
  });

  const removeOverride = useMutation({
    mutationFn: (id: string) => deleteOverrideFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t(`${K}.mapping.deletedToast`));
      await refreshOverrides();
    },
    onError: fail,
  });

  const busy =
    createVersion.isPending ||
    approveVersion.isPending ||
    saveMapping.isPending ||
    removeMapping.isPending ||
    saveOverride.isPending ||
    removeOverride.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.mapping.title`)}
        description={t(`${K}.mapping.description`)}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link
              to="/projects/$projectId/costing/evm"
              params={{ projectId }}
              search={{ period }}
            >
              <ArrowLeft className="size-4" /> {t(`${K}.mapping.backToCockpit`)}
            </Link>
          </Button>
        }
      />

      <EvmMappingEditor
        versions={versions.data}
        selectedVersionId={activeVersionId}
        onSelectVersion={setSelectedVersionId}
        mappings={mappings.data ?? []}
        catalog={catalog.data}
        defaultMethod={workspace.data.computed.settings.default_progress_method}
        canWrite={canWrite}
        busy={busy}
        onCreateVersion={() => createVersion.mutate()}
        onApproveVersion={(id) => approveVersion.mutate(id)}
        onSave={(draft) => saveMapping.mutate(draft)}
        onDelete={(id) => removeMapping.mutate(id)}
      />

      <EvmOverridePanel
        overrides={overrides.data ?? []}
        catalog={catalog.data}
        period={period}
        canWrite={canWrite}
        busy={busy}
        onSave={(draft) => saveOverride.mutate(draft)}
        onDelete={(id) => removeOverride.mutate(id)}
      />
    </div>
  );
}
