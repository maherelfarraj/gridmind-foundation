// P-210 — Rate picker combobox: search the rate library and apply a rate to a
// line in one mutation. Expired rates are muted, never labelled "current".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library } from "lucide-react";

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
import { rateLibraryQueryOptions } from "@/lib/estimating.query";
import { RATE_TYPE_LABELS, rateValidity, type EstimateRateType } from "@/lib/estimating.rules";
import type { RateRowRecord } from "@/lib/estimating.server";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RatePickerButton({ onApply }: { onApply: (rate: RateRowRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = useQuery({ ...rateLibraryQueryOptions(null), enabled: open });

  const today = query.data?.today ?? new Date().toISOString().slice(0, 10);
  const rates = (query.data?.rates ?? []).filter((r) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [r.name, r.rate_type, r.supplier ?? "", r.category ?? ""].some((v) =>
      v.toLowerCase().includes(s),
    );
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" aria-label="Apply a rate from the rate library">
          <Library className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search rates by name, type or supplier"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {query.isLoading ? "Loading rates…" : "No matching rates in the library."}
            </CommandEmpty>
            <CommandGroup>
              {rates.map((rate) => {
                const validity = rateValidity(rate.valid_to, today);
                const expired = validity === "expired";
                return (
                  <CommandItem
                    key={rate.id}
                    value={rate.id}
                    onSelect={() => {
                      onApply(rate);
                      setOpen(false);
                    }}
                    className={cn("flex flex-col items-start gap-1", expired && "opacity-60")}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className={cn("truncate", expired && "text-muted-foreground")}>
                        {rate.name}
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(rate.unit_rate, rate.currency_code, {
                          maximumFractionDigits: 2,
                        })}
                        /{rate.uom}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="mutedOutline">
                        {RATE_TYPE_LABELS[rate.rate_type as EstimateRateType] ?? rate.rate_type}
                      </Badge>
                      {rate.supplier ? <span className="truncate">{rate.supplier}</span> : null}
                      {expired ? (
                        <Badge variant="mutedOutline">expired</Badge>
                      ) : validity === "expiring" ? (
                        <Badge variant="warning">expiring</Badge>
                      ) : (
                        <Badge variant="success">current</Badge>
                      )}
                    </span>
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
