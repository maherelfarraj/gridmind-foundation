// P-063 — Invite eligible vendors dialog (multi-select by name search).
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listRfqEligibleVendors } from "@/lib/rfq.functions";
import { rfqEligibleVendorsQueryOptions } from "@/lib/rfq-query";

export function InviteVendorDialog({
  alreadyInvited,
  onInvite,
  trigger,
  disabled,
}: {
  alreadyInvited: Set<string>;
  onInvite: (vendorIds: string[]) => Promise<unknown> | void;
  trigger: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const fn = useServerFn(listRfqEligibleVendors);
  const vendorsQuery = useSuspenseQuery(
    rfqEligibleVendorsQueryOptions(fn, search.trim() || null),
  );

  const rows = useMemo(
    () => vendorsQuery.data.filter((v) => !alreadyInvited.has(v.id)),
    [vendorsQuery.data, alreadyInvited],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await onInvite(Array.from(selected));
      setSelected(new Set());
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild disabled={disabled}>
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite vendors</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search active vendors…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ScrollArea className="h-64 rounded-md border border-border">
            {rows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No eligible active vendors. Onboard a vendor first.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((v) => {
                  const isSelected = selected.has(v.id);
                  return (
                    <li
                      key={v.id}
                      className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-muted"
                      onClick={() => toggle(v.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <span className="text-sm font-medium">{v.name}</span>
                      </div>
                      {v.currency_code && (
                        <Badge variant="outline" className="text-xs">
                          {v.currency_code}
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={selected.size === 0 || busy}>
            Invite {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
