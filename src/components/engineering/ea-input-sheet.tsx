// P-169 — Generic input sheet: renders any calculator's zod schema as a form.
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emptyRow, type EaField } from "@/lib/ea/form-spec";

type FormValues = Record<string, unknown>;
type Form = UseFormReturn<FormValues>;

function optionLabel(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ScalarField({
  field,
  form,
  path,
  dense = false,
  disabled,
}: {
  field: EaField;
  form: Form;
  path: string;
  dense?: boolean;
  disabled: boolean;
}) {
  const id = `ea-${path.replace(/\./g, "-")}`;
  const label = field.unit ? `${field.label} (${field.unit})` : field.label;

  if (field.kind === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
        <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
          {label}
        </Label>
        <Switch
          id={id}
          disabled={disabled}
          checked={Boolean(form.watch(path))}
          onCheckedChange={(v) => form.setValue(path, v, { shouldDirty: true })}
        />
      </div>
    );
  }

  if (field.kind === "enum") {
    return (
      <div className="space-y-1.5">
        {!dense ? (
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            {label}
          </Label>
        ) : null}
        <Select
          disabled={disabled}
          value={String(form.watch(path) ?? "")}
          onValueChange={(v) => form.setValue(path, v, { shouldDirty: true })}
        >
          <SelectTrigger id={id} className="h-9">
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {optionLabel(opt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const numeric = field.kind === "number" || field.kind === "integer";
  return (
    <div className="space-y-1.5">
      {!dense ? (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      ) : null}
      <Input
        id={id}
        disabled={disabled}
        className="h-9"
        inputMode={numeric ? "decimal" : undefined}
        type={numeric ? "number" : "text"}
        step={field.kind === "integer" ? 1 : "any"}
        placeholder={dense ? label : undefined}
        {...form.register(path)}
      />
    </div>
  );
}

function GridField({ field, form, disabled }: { field: EaField; form: Form; disabled: boolean }) {
  const columns = field.columns ?? [];
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: field.name as never,
  });

  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{field.label}</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => append(emptyRow(columns) as never)}
        >
          <Plus className="mr-1 size-3.5" aria-hidden /> Add row
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">
          No rows yet — add at least one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {columns.map((col) => (
                  <th key={col.name} className="px-2 py-1.5 font-medium">
                    {col.unit ? `${col.label} (${col.unit})` : col.label}
                  </th>
                ))}
                <th className="w-10 px-2 py-1.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {fields.map((row, index) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  {columns.map((col) => (
                    <td key={col.name} className="px-1 py-1 align-middle">
                      <ScalarField
                        field={col}
                        form={form}
                        dense
                        disabled={disabled}
                        path={`${field.name}.${index}.${col.name}`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ListField({ field, form, disabled }: { field: EaField; form: Form; disabled: boolean }) {
  const raw = form.watch(field.name);
  const items = Array.isArray(raw) ? (raw as unknown[]) : [];
  const setItems = (next: unknown[]) => form.setValue(field.name, next, { shouldDirty: true });

  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">
          {field.unit ? `${field.label} (${field.unit})` : field.label}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setItems([...items, field.itemKind === "number" ? 0 : ""])}
        >
          <Plus className="mr-1 size-3.5" aria-hidden /> Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          items.map((item, index) => (
            <div key={`${field.name}-${index}`} className="flex items-center gap-1">
              <Input
                className="h-9 w-28"
                disabled={disabled}
                type={field.itemKind === "number" ? "number" : "text"}
                value={String(item ?? "")}
                aria-label={`${field.label} ${index + 1}`}
                onChange={(e) => {
                  const next = [...items];
                  next[index] =
                    field.itemKind === "number" ? Number(e.target.value) : e.target.value;
                  setItems(next);
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove entry ${index + 1}`}
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function EaInputSheet({
  fields,
  form,
  disabled = false,
}: {
  fields: EaField[];
  form: Form;
  disabled?: boolean;
}) {
  const scalars = fields.filter((f) => f.kind !== "grid" && f.kind !== "list");
  const collections = fields.filter((f) => f.kind === "grid" || f.kind === "list");

  return (
    <div className="space-y-4">
      {scalars.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scalars.map((field) => (
            <ScalarField
              key={field.name}
              field={field}
              form={form}
              path={field.name}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}
      {collections.map((field) =>
        field.kind === "grid" ? (
          <GridField key={field.name} field={field} form={form} disabled={disabled} />
        ) : (
          <ListField key={field.name} field={field} form={form} disabled={disabled} />
        ),
      )}
    </div>
  );
}
