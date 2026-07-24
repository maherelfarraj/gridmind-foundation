// P-039 — Reusable key-value editor for JSON array config fields.
import { Plus, X } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function KeyValueEditor({
  control,
  name,
  keyPlaceholder = "Name",
  valuePlaceholder = "Value",
  disabled,
}: {
  control: Control<any>;
  name: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control, name });
  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">No entries yet.</p>
      )}
      {fields.map((field, idx) => (
        <div key={field.id} className="flex items-center gap-2">
          <Input
            {...control.register(`${name}.${idx}.key` as const)}
            placeholder={keyPlaceholder}
            disabled={disabled}
            className="max-w-[40%]"
          />
          <Input
            {...control.register(`${name}.${idx}.value` as const)}
            placeholder={valuePlaceholder}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => remove(idx)}
            aria-label="Remove entry"
          >
            <X size={14} aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => append({ key: "", value: "" })}
        >
          <Plus size={14} aria-hidden />
          Add entry
        </Button>
      </div>
    </div>
  );
}
