// P-139 — Symbol registry admin: company-specific overrides on top of the global library.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SymbolGlyph } from "@/components/engineering/sld-cad/symbol-glyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeleteSymbolType,
  useSymbolRegistry,
  useUpsertSymbolType,
} from "@/lib/sld-symbols-query";
import {
  CATEGORY_LABELS,
  SYMBOL_CATEGORIES,
  filterSymbols,
  type SymbolCategory,
  type SymbolTypeRecord,
} from "@/lib/sld/symbol-registry";

export const Route = createFileRoute("/_authenticated/settings/sld-symbols")({
  component: SldSymbolsPage,
  head: () => ({
    meta: [
      { title: "SLD symbol registry — GridMind EPC" },
      {
        name: "description",
        content:
          "Review the global electrical symbol library and manage company-specific symbol overrides for single line diagrams.",
      },
    ],
  }),
});

type FormState = {
  id?: string;
  type_key: string;
  display_name: string;
  category: SymbolCategory;
  tag_prefix: string;
  sort_order: number;
  svg_body: string;
  ports: string;
  property_schema: string;
  default_properties: string;
};

const EMPTY_FORM: FormState = {
  type_key: "",
  display_name: "",
  category: "conversion",
  tag_prefix: "SYM",
  sort_order: 500,
  svg_body: '<rect x="8" y="8" width="24" height="24" rx="2" />',
  ports: '[{ "key": "in", "x": 20, "y": 8 }, { "key": "out", "x": 20, "y": 32 }]',
  property_schema: '[{ "key": "rating_kw", "label": "Rating", "type": "number", "unit": "kW" }]',
  default_properties: "{}",
};

function toForm(record: SymbolTypeRecord): FormState {
  return {
    id: record.company_id ? record.id : undefined,
    type_key: record.type_key,
    display_name: record.display_name,
    category: record.category,
    tag_prefix: record.tag_prefix,
    sort_order: record.sort_order,
    svg_body: record.svg_body,
    ports: JSON.stringify(record.ports ?? [], null, 2),
    property_schema: JSON.stringify(record.property_schema ?? [], null, 2),
    default_properties: JSON.stringify(record.default_properties ?? {}, null, 2),
  };
}

function SldSymbolsPage() {
  const registry = useSymbolRegistry();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const upsert = useUpsertSymbolType(() => setForm(null));
  const remove = useDeleteSymbolType();

  const canManage = registry.data?.canManage ?? false;
  const rows = useMemo(
    () => filterSymbols(registry.data?.symbols ?? [], query),
    [registry.data?.symbols, query],
  );

  const submit = () => {
    if (!form) return;
    try {
      upsert.mutate({
        ...(form.id ? { id: form.id } : {}),
        type_key: form.type_key,
        display_name: form.display_name,
        category: form.category,
        tag_prefix: form.tag_prefix.toUpperCase(),
        sort_order: Number(form.sort_order) || 500,
        svg_body: form.svg_body,
        ports: JSON.parse(form.ports || "[]"),
        property_schema: JSON.parse(form.property_schema || "[]"),
        default_properties: JSON.parse(form.default_properties || "{}"),
      });
    } catch {
      toast.error("Ports, property schema and defaults must be valid JSON.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLD symbol registry"
        description="The electrical symbol library used by the SLD canvas. Global symbols are shared; company overrides replace a global symbol of the same key."
        actions={
          canManage ? (
            <Button onClick={() => setForm({ ...EMPTY_FORM })}>
              <Plus className="mr-2 size-4" />
              New override
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbols"
              aria-label="Search symbols"
              className="pl-8"
            />
          </div>

          {registry.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="No symbols found" description="Adjust your search and try again." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Symbol</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((sym) => (
                  <TableRow key={sym.id}>
                    <TableCell>
                      <SymbolGlyph svg={sym.svg_body} size={28} className="text-foreground" />
                    </TableCell>
                    <TableCell className="font-medium">{sym.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">{sym.type_key}</TableCell>
                    <TableCell>{CATEGORY_LABELS[sym.category] ?? sym.category}</TableCell>
                    <TableCell className="tabular-nums">{sym.tag_prefix}</TableCell>
                    <TableCell>
                      <Badge variant={sym.company_id ? "default" : "outline"}>
                        {sym.company_id ? "Company" : "Global"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Edit ${sym.display_name}`}
                            onClick={() => setForm(toForm(sym))}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {sym.company_id ? (
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label={`Remove ${sym.display_name}`}
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(sym.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read-only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={form !== null} onOpenChange={(open) => (open ? null : setForm(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit symbol override" : "New symbol override"}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="sym-key">Type key</Label>
                  <Input
                    id="sym-key"
                    value={form.type_key}
                    onChange={(e) => setForm({ ...form, type_key: e.target.value })}
                    placeholder="inverter"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sym-name">Display name</Label>
                  <Input
                    id="sym-name"
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v as SymbolCategory })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SYMBOL_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="sym-prefix">Tag prefix</Label>
                    <Input
                      id="sym-prefix"
                      value={form.tag_prefix}
                      onChange={(e) =>
                        setForm({ ...form, tag_prefix: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sym-sort">Sort order</Label>
                    <Input
                      id="sym-sort"
                      type="number"
                      value={form.sort_order}
                      onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="sym-svg">SVG body (40×40 viewBox)</Label>
                <Textarea
                  id="sym-svg"
                  rows={4}
                  value={form.svg_body}
                  onChange={(e) => setForm({ ...form, svg_body: e.target.value })}
                  className="font-mono text-xs"
                />
                <div className="flex items-center gap-2 rounded-md border border-border p-2">
                  <SymbolGlyph svg={form.svg_body} size={40} className="text-foreground" />
                  <span className="text-xs text-muted-foreground">Live preview</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="sym-ports">Ports (JSON)</Label>
                <Textarea
                  id="sym-ports"
                  rows={3}
                  value={form.ports}
                  onChange={(e) => setForm({ ...form, ports: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sym-schema">Property schema (JSON)</Label>
                <Textarea
                  id="sym-schema"
                  rows={4}
                  value={form.property_schema}
                  onChange={(e) => setForm({ ...form, property_schema: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sym-defaults">Default properties (JSON)</Label>
                <Textarea
                  id="sym-defaults"
                  rows={3}
                  value={form.default_properties}
                  onChange={(e) => setForm({ ...form, default_properties: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save symbol"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
