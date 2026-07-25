// P-072 — WBS node detail form.
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  WBS_CODE_REGEX,
  WBS_DISCIPLINES,
  WBS_DISCIPLINE_LABEL,
  WBS_ITEM_TYPES,
  WBS_ITEM_TYPE_LABEL,
  type WbsDiscipline,
  type WbsItemType,
} from "@/lib/wbs-rules";
import type { WbsItemRow } from "@/lib/wbs.functions";

interface WbsDetailFormProps {
  item: WbsItemRow | null;
  currencies: Array<{ code: string; name: string; symbol: string | null }>;
  canWrite: boolean;
  saving: boolean;
  onSave: (patch: {
    code?: string;
    name?: string;
    item_type?: WbsItemType;
    discipline?: WbsDiscipline | null;
    description?: string | null;
    sort_order?: number;
    budgeted_amount?: number | null;
    currency_code?: string | null;
  }) => void;
}

const NONE = "__none";

export function WbsDetailForm({ item, currencies, canWrite, saving, onSave }: WbsDetailFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<WbsItemType>("phase");
  const [discipline, setDiscipline] = useState<WbsDiscipline | "">("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState<string>("");
  const [currency, setCurrency] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setCode(item.code);
    setName(item.name);
    setItemType(item.item_type);
    setDiscipline((item.discipline ?? "") as WbsDiscipline | "");
    setDescription(item.description ?? "");
    setBudget(item.budgeted_amount == null ? "" : String(item.budgeted_amount));
    setCurrency(item.currency_code ?? "");
    setSortOrder(String(item.sort_order ?? 0));
    setError(null);
  }, [item]);

  if (!item) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-1 text-sm text-muted-foreground">
        <p className="text-foreground">Select a WBS item</p>
        <p>Pick a node on the left to edit its details.</p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!WBS_CODE_REGEX.test(code.trim())) {
      setError("Code must be dotted numeric (e.g. 1, 1.2, 1.2.3).");
      return;
    }
    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    const bud = budget.trim() === "" ? null : Number(budget);
    if (bud !== null && (!Number.isFinite(bud) || bud < 0)) {
      setError("Budget must be a positive number.");
      return;
    }
    const so = Number(sortOrder);
    if (!Number.isFinite(so) || so < 0) {
      setError("Sort order must be zero or positive.");
      return;
    }
    onSave({
      code: code.trim(),
      name: name.trim(),
      item_type: itemType,
      discipline: (discipline || null) as WbsDiscipline | null,
      description: description.trim() === "" ? null : description.trim(),
      budgeted_amount: bud,
      currency_code: currency === "" ? null : currency,
      sort_order: so,
    });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div>
        <h3 className="font-display text-base font-semibold text-foreground">Item details</h3>
        <p className="text-xs text-muted-foreground">
          Editing {item.code} — {item.name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wbs-code">Code</Label>
          <Input
            id="wbs-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!canWrite}
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wbs-sort">Sort order</Label>
          <Input
            id="wbs-sort"
            type="number"
            min={0}
            step={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            disabled={!canWrite}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="wbs-name">Name</Label>
        <Input
          id="wbs-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canWrite}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label>Type</Label>
          <Select
            value={itemType}
            onValueChange={(v) => setItemType(v as WbsItemType)}
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WBS_ITEM_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {WBS_ITEM_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Discipline</Label>
          <Select
            value={discipline === "" ? NONE : discipline}
            onValueChange={(v) => setDiscipline(v === NONE ? "" : (v as WbsDiscipline))}
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {WBS_DISCIPLINES.map((d) => (
                <SelectItem key={d} value={d}>
                  {WBS_DISCIPLINE_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wbs-budget">Budget</Label>
          <Input
            id="wbs-budget"
            type="number"
            min={0}
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={!canWrite}
            placeholder="—"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Currency</Label>
          <Select
            value={currency === "" ? NONE : currency}
            onValueChange={(v) => setCurrency(v === NONE ? "" : v)}
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {currencies.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="wbs-desc">Description</Label>
        <Textarea
          id="wbs-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={!canWrite}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!canWrite || saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
