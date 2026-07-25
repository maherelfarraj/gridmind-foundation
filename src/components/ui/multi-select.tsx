// POL-3 — Shared multi-select combobox: chip display with remove ×, in-list search,
// and an "N selected" collapsed state.
import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  /** Above this many selections the trigger collapses to "N selected". */
  maxChips = 3,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  maxChips?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const byValue = React.useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options],
  );

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const collapsed = value.length > maxChips;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between gap-2 font-normal",
            value.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {value.length === 0 ? (
              placeholder
            ) : collapsed ? (
              <span className="text-sm text-foreground">{value.length} selected</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="muted" className="gap-1">
                  <span className="truncate">{byValue.get(v) ?? v}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${byValue.get(v) ?? v}`}
                    className="rounded-sm hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const selected = value.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <Check
                      className={cn("mr-2 size-4", selected ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {o.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
