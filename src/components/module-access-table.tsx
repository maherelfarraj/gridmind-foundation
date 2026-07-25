import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  listModuleAccess,
  setModuleAccess,
  type ModuleAccessResult,
  type ModuleAccessRow,
} from "@/lib/modules.functions";
import type { PlanTier } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const ALL_PLANS: PlanTier[] = ["starter", "growth", "enterprise"];
const PLAN_LABEL: Record<PlanTier, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

export interface ModuleAccessTableProps {
  companyId: string;
  canEdit: boolean;
}

export function ModuleAccessTable({ companyId, canEdit }: ModuleAccessTableProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listModuleAccess);
  const setFn = useServerFn(setModuleAccess);
  const queryKey = ["modules", companyId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { companyId } }),
  });

  const mutation = useMutation({
    mutationFn: (vars: { module: ModuleAccessRow["key"]; enabled: boolean }) =>
      setFn({
        data: { companyId, module: vars.module, enabled: vars.enabled },
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const snapshot = queryClient.getQueryData<ModuleAccessResult>(queryKey);
      if (snapshot) {
        queryClient.setQueryData<ModuleAccessResult>(queryKey, {
          ...snapshot,
          modules: snapshot.modules.map((m) =>
            m.key === vars.module ? { ...m, enabled: vars.enabled, source: "override" } : m,
          ),
        });
      }
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(queryKey, ctx.snapshot);
      const msg = err instanceof Error ? err.message : "Failed to update module";
      toast.error(msg);
    },
    onSuccess: (_data, vars) => {
      toast.success(`${vars.enabled ? "Enabled" : "Disabled"} ${vars.module}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <p className="mb-2 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Failed to load module access.
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const { planTier, modules } = query.data;
  const editable = canEdit && query.data.canEdit;
  const pendingKey = mutation.isPending && mutation.variables ? mutation.variables.module : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[38%]">Module</TableHead>
              <TableHead>Plan availability</TableHead>
              <TableHead className="w-[120px] text-right">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((row) => {
              const planBlocked = !row.allowedByPlan;
              const disabledSwitch = !editable || planBlocked || mutation.isPending;
              const tooltipMsg =
                row.enterpriseOnly && planTier !== "enterprise"
                  ? "Green H₂ requires the Enterprise plan — upgrade to enable."
                  : planBlocked
                    ? `Not included in the ${PLAN_LABEL[planTier]} plan.`
                    : null;

              const switchNode = (
                <Switch
                  checked={row.enabled}
                  disabled={disabledSwitch}
                  onCheckedChange={(checked) =>
                    mutation.mutate({ module: row.key, enabled: checked })
                  }
                  aria-label={`Toggle ${row.label}`}
                />
              );

              return (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {row.label}
                        {row.source === "override" && (
                          <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                            override
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.description}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_PLANS.map((p) => {
                        const included = row.baselinePlans.includes(p);
                        return (
                          <Badge
                            key={p}
                            variant={included ? "secondary" : "outline"}
                            className={included ? undefined : "text-muted-foreground opacity-60"}
                          >
                            {PLAN_LABEL[p]}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      {pendingKey === row.key && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                      {!editable && row.enabled && (
                        <Check className="h-4 w-4 text-muted-foreground" aria-hidden />
                      )}
                      {tooltipMsg ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">{switchNode}</span>
                          </TooltipTrigger>
                          <TooltipContent>{tooltipMsg}</TooltipContent>
                        </Tooltip>
                      ) : (
                        switchNode
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
