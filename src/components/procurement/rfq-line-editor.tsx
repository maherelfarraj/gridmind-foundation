// P-063 — RFQ line editor (react-hook-form field-array wrapped in a table).
import { useFieldArray, type Control } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RfqDraftFormValues {
  title: string;
  projectId: string;
  currencyCode: string;
  issueDate: string | null;
  dueDate: string | null;
  terms: string | null;
  description: string | null;
  lines: Array<{
    line_no: number;
    description: string;
    spec: string | null;
    qty: number;
    uom: string;
    target_price: number | null;
    site_need_date: string | null;
  }>;
}

export function RfqLineEditor({
  control,
  disabled,
}: {
  control: Control<RfqDraftFormValues>;
  disabled?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  function nextLineNo(): number {
    const nos = (fields as any[]).map((f) => Number(f.line_no ?? 0));
    return (nos.length === 0 ? 0 : Math.max(...nos)) + 1;
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-40">Spec</TableHead>
            <TableHead className="w-24">Qty</TableHead>
            <TableHead className="w-24">UoM</TableHead>
            <TableHead className="w-32">Target price</TableHead>
            <TableHead className="w-36">Site need date</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                No lines yet — add at least one before issuing.
              </TableCell>
            </TableRow>
          )}
          {fields.map((field, idx) => (
            <TableRow key={field.id}>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  disabled={disabled}
                  defaultValue={(field as any).line_no}
                  {...control.register(`lines.${idx}.line_no` as const, {
                    valueAsNumber: true,
                  })}
                />
              </TableCell>
              <TableCell>
                <Input
                  disabled={disabled}
                  defaultValue={(field as any).description}
                  {...control.register(`lines.${idx}.description` as const)}
                />
              </TableCell>
              <TableCell>
                <Input
                  disabled={disabled}
                  defaultValue={(field as any).spec ?? ""}
                  {...control.register(`lines.${idx}.spec` as const)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled}
                  defaultValue={(field as any).qty}
                  {...control.register(`lines.${idx}.qty` as const, {
                    valueAsNumber: true,
                  })}
                />
              </TableCell>
              <TableCell>
                <Input
                  disabled={disabled}
                  defaultValue={(field as any).uom}
                  {...control.register(`lines.${idx}.uom` as const)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled}
                  defaultValue={(field as any).target_price ?? ""}
                  {...control.register(`lines.${idx}.target_price` as const, {
                    setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                  })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="date"
                  disabled={disabled}
                  defaultValue={(field as any).site_need_date ?? ""}
                  {...control.register(`lines.${idx}.site_need_date` as const, {
                    setValueAs: (v) => (v === "" ? null : v),
                  })}
                />
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => remove(idx)}
                  aria-label={`Remove line ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            append({
              line_no: nextLineNo(),
              description: "",
              spec: null,
              qty: 1,
              uom: "pcs",
              target_price: null,
              site_need_date: null,
            })
          }
        >
          <Plus className="mr-2 h-4 w-4" /> Add line
        </Button>
      </div>
    </div>
  );
}
