// GC-09 — Saved views bar for Portfolio Cost & Close.
// Private by default; sharing is server-authorized and owner-only to mutate.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Check, Copy, Share2, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/locale-provider";
import { savedViewsQueryOptions } from "@/lib/portfolio-governance.query";
import {
  createPortfolioView,
  deletePortfolioView,
  duplicatePortfolioView,
  updatePortfolioView,
} from "@/lib/portfolio-views.functions";
import {
  configToSearch,
  searchToConfig,
  type PortfolioCostingSearch,
  type SavedView,
} from "@/lib/portfolio-views.rules";

const K = "portfolioMod.costing.views";

export function SavedViewsBar({
  search,
  onApply,
}: {
  search: PortfolioCostingSearch;
  onApply: (next: PortfolioCostingSearch) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: views } = useSuspenseQuery(savedViewsQueryOptions());
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  const create = useServerFn(createPortfolioView);
  const update = useServerFn(updatePortfolioView);
  const duplicate = useServerFn(duplicatePortfolioView);
  const remove = useServerFn(deletePortfolioView);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["portfolio", "saved-views"] });
  const fail = () => toast.error(t(`${K}.failed`));

  const saveMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name,
          description: null,
          config: searchToConfig(search),
          is_shared: false,
          is_default: false,
        },
      }),
    onSuccess: () => {
      setSaveOpen(false);
      setName("");
      toast.success(t(`${K}.saved`));
      void invalidate();
    },
    onError: fail,
  });

  const patchMutation = useMutation({
    mutationFn: (input: {
      id: string;
      is_shared?: boolean;
      is_default?: boolean;
      config?: ReturnType<typeof searchToConfig>;
    }) => update({ data: input }),
    onSuccess: () => {
      toast.success(t(`${K}.updated`));
      void invalidate();
    },
    onError: fail,
  });

  const duplicateMutation = useMutation({
    mutationFn: (view: SavedView) =>
      duplicate({
        data: { id: view.id, name: t(`${K}.copyOf`, { name: view.name }).slice(0, 80) },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.duplicated`));
      void invalidate();
    },
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t(`${K}.deleted`));
      void invalidate();
    },
    onError: fail,
  });

  const [selectedId, setSelectedId] = useState<string>("");
  const selected = views.find((v) => v.id === selectedId) ?? null;

  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      <div className="space-y-1">
        <Label htmlFor="saved-view">{t(`${K}.label`)}</Label>
        <Select
          value={selectedId}
          onValueChange={(id) => {
            setSelectedId(id);
            const view = views.find((v) => v.id === id);
            if (view) onApply(configToSearch(view.config));
          }}
        >
          <SelectTrigger id="saved-view" className="w-64">
            <SelectValue placeholder={t(`${K}.placeholder`)} />
          </SelectTrigger>
          <SelectContent>
            {views.length === 0 ? (
              <SelectItem value="__none__" disabled>
                {t(`${K}.none`)}
              </SelectItem>
            ) : (
              views.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                  {v.is_default ? ` · ${t(`${K}.defaultBadge`)}` : ""}
                  {v.is_shared ? ` · ${t(`${K}.sharedBadge`)}` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
          <Bookmark className="size-4" /> {t(`${K}.save`)}
        </Button>
        {selected ? (
          <>
            {selected.is_owner ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchMutation.mutate({ id: selected.id, config: searchToConfig(search) })
                  }
                >
                  <Check className="size-4" /> {t(`${K}.updateFromFilters`)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchMutation.mutate({ id: selected.id, is_default: !selected.is_default })
                  }
                  aria-pressed={selected.is_default}
                >
                  <Star className="size-4" />{" "}
                  {selected.is_default ? t(`${K}.unsetDefault`) : t(`${K}.setDefault`)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchMutation.mutate({ id: selected.id, is_shared: !selected.is_shared })
                  }
                  aria-pressed={selected.is_shared}
                >
                  <Share2 className="size-4" />{" "}
                  {selected.is_shared ? t(`${K}.unshare`) : t(`${K}.share`)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteMutation.mutate(selected.id)}
                >
                  <Trash2 className="size-4" /> {t(`${K}.delete`)}
                </Button>
              </>
            ) : (
              <Badge variant="muted">
                {t(`${K}.ownedBy`, { name: selected.owner_name ?? t(`${K}.someone`) })}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => duplicateMutation.mutate(selected)}>
              <Copy className="size-4" /> {t(`${K}.duplicate`)}
            </Button>
          </>
        ) : null}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(`${K}.dialogTitle`)}</DialogTitle>
            <DialogDescription>{t(`${K}.dialogDescription`)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="view-name">{t(`${K}.nameLabel`)}</Label>
            <Input
              id="view-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={name.trim().length === 0 || saveMutation.isPending}
            >
              {t(`${K}.save`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
