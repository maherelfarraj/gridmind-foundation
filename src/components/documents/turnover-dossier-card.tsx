// P-267 — Turnover dossier compiler: compile → preview gaps → generate the
// branded PDF bundle → register it as a permanent controlled document.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileArchive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanySettings } from "@/lib/company.functions";
import { buildTurnoverDossierPdf } from "@/lib/exports/turnover-dossier-pdf";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  compileTurnoverDossier,
  listTurnoverDossiers,
  registerTurnoverDossier,
} from "@/lib/turnover-dossier.functions";
import { chapterCounts } from "@/lib/turnover-dossier.rules";

export function TurnoverDossierCard({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const compileFn = useServerFn(compileTurnoverDossier);
  const registerFn = useServerFn(registerTurnoverDossier);
  const settingsFn = useServerFn(getCompanySettings);
  const listFn = useServerFn(listTurnoverDossiers);
  const [result, setResult] = useState<Awaited<ReturnType<typeof compileFn>> | null>(null);

  const previous = useQuery({
    queryKey: ["turnover-dossiers", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const [compilation, settings] = await Promise.all([
        compileFn({ data: { projectId } }),
        settingsFn(),
      ]);
      setResult(compilation);

      const branding = settings.branding;
      const pdf = buildTurnoverDossierPdf({
        company: {
          name: settings.company.name,
          legalName: settings.company.legal_name ?? null,
        },
        project: {
          name: compilation.project.name,
          code: compilation.project.code,
          targetCod: compilation.project.targetCod,
        },
        branding: {
          primaryColor: branding?.primary_color ?? null,
          accentColor: branding?.accent_color ?? null,
          logoDataUrl: null,
        },
        chapters: compilation.chapters,
        compiledAt: new Date().toISOString(),
      });

      const registration = await registerFn({
        data: {
          projectId,
          complete: pdf.complete,
          gaps: compilation.gaps as unknown as Record<string, unknown>[],
          chapters: chapterCounts(compilation.chapters) as unknown as Record<string, unknown>[],
        },
      });

      const blob = new Blob([pdf.bytes as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${registration.docNumber}-turnover-dossier.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      return registration;
    },
    onSuccess: (registration) => {
      toast.success(t("engMod.dossier.registered", { doc: registration.docNumber }));
      void queryClient.invalidateQueries({ queryKey: ["turnover-dossiers", projectId] });
    },
    onError: () => toast.error(t("engMod.dossier.failed")),
  });

  const counts = result ? chapterCounts(result.chapters) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("engMod.dossier.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("engMod.dossier.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileArchive className="mr-2 h-4 w-4" />
          )}
          {generate.isPending ? t("engMod.dossier.generating") : t("engMod.dossier.generate")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && (
          <>
            <div className="flex items-center gap-2">
              {result.complete ? (
                <Badge variant="secondary">{t("engMod.dossier.complete")}</Badge>
              ) : (
                <Badge variant="destructive">
                  {t("engMod.dossier.incomplete")} ·{" "}
                  {t("engMod.dossier.gaps", { count: result.gapTotal })}
                </Badge>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t("engMod.dossier.chapters")}
              </p>
              {counts.map((c) => (
                <div
                  key={c.key}
                  className="flex justify-between border-b border-border py-1 text-sm last:border-0"
                >
                  <span>{c.title}</span>
                  <span className="text-muted-foreground">
                    {c.count} {t("engMod.dossier.records")}
                    {c.gaps > 0 ? ` · ${t("engMod.dossier.gaps", { count: c.gaps })}` : ""}
                  </span>
                </div>
              ))}
            </div>

            {result.gaps.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("engMod.dossier.gapList")}
                </p>
                {result.gaps.map((g, i) => (
                  <p key={`${g.chapter}-${i}`} className="text-xs text-destructive">
                    {g.chapterTitle} — {g.detail}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("engMod.dossier.previous")}
          </p>
          {(previous.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("engMod.dossier.none")}</p>
          ) : (
            (previous.data ?? []).map((d: Record<string, unknown>) => (
              <div
                key={String(d.id)}
                className="flex justify-between border-b border-border py-1 text-sm last:border-0"
              >
                <span>{String(d.dossier_number ?? "—")}</span>
                <span className="text-muted-foreground">
                  {String(d.generated_at ?? "").slice(0, 10)} ·{" "}
                  {d.complete
                    ? t("engMod.dossier.complete")
                    : t("engMod.dossier.gaps", { count: Number(d.gap_count ?? 0) })}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
