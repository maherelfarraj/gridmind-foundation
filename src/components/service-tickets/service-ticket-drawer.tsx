// P-109 — Service ticket drawer with status transitions + SLA credit form.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { SlaCountdownChip } from "@/components/service-tickets/sla-countdown-chip";
import { applySlaCredit, updateTicket, type TicketRow } from "@/lib/service-tickets.functions";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/service-tickets.rules";

interface Props {
  ticket: TicketRow | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}

function priorityColor(priority: string) {
  switch (priority) {
    case "emergency":
      return "bg-destructive text-destructive-foreground";
    case "high":
      return "bg-warning text-warning-foreground";
    case "medium":
      return "bg-primary text-primary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function ServiceTicketDrawer({ ticket, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateTicket);
  const creditFn = useServerFn(applySlaCredit);

  const [monthlyFee, setMonthlyFee] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");

  const updateMut = useMutation({
    mutationFn: (input: { id: string; status?: TicketStatus }) => updateFn({ data: input }),
    onSuccess: () => {
      toast.success("Ticket updated");
      qc.invalidateQueries({ queryKey: ["service-tickets"] });
      qc.invalidateQueries({ queryKey: ["breach-log"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to update"),
  });

  const creditMut = useMutation({
    mutationFn: (v: { ticket_id: string; monthly_fee: number; currency_code: string }) =>
      creditFn({ data: v }),
    onSuccess: (row: { credit_pct: number; credit_amount: number | null }) => {
      toast.success(
        `Credit applied: ${row.credit_pct}%${
          row.credit_amount != null ? ` (${row.credit_amount})` : ""
        }`,
      );
      qc.invalidateQueries({ queryKey: ["service-tickets"] });
      qc.invalidateQueries({ queryKey: ["breach-log"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to apply credit"),
  });

  if (!ticket) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{ticket.ticket_number}</span>
            <Badge className={priorityColor(ticket.priority)}>{ticket.priority}</Badge>
            <Badge variant="outline">{ticket.status}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div>
            <div className="text-sm font-medium">{ticket.title}</div>
            {ticket.description ? (
              <p className="text-sm text-muted-foreground">{ticket.description}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Project</div>
              <div>{ticket.project_name ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Assignee</div>
              <div>{ticket.assignee_name ?? "Unassigned"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Category</div>
              <div>{ticket.category}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Created</div>
              <div>{new Date(ticket.created_at).toLocaleString()}</div>
            </div>
          </div>

          <Separator />

          <div>
            <div className="mb-2 text-xs uppercase text-muted-foreground">Status transitions</div>
            <div className="flex flex-wrap gap-2">
              {TICKET_STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === ticket.status ? "default" : "outline"}
                  disabled={s === ticket.status || updateMut.isPending}
                  onClick={() => updateMut.mutate({ id: ticket.id, status: s })}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">SLA</div>
            {ticket.sla ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Response due</div>
                  <div>{new Date(ticket.sla.response_due_at).toLocaleString()}</div>
                  <div className="mt-1">
                    <SlaCountdownChip
                      createdAtISO={ticket.created_at}
                      dueAtISO={ticket.sla.response_due_at}
                      label="R"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Resolution due</div>
                  <div>{new Date(ticket.sla.resolution_due_at).toLocaleString()}</div>
                  <div className="mt-1">
                    <SlaCountdownChip
                      createdAtISO={ticket.created_at}
                      dueAtISO={ticket.sla.resolution_due_at}
                      label="F"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Responded at</div>
                  <div>
                    {ticket.sla.responded_at
                      ? new Date(ticket.sla.responded_at).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Resolved at</div>
                  <div>
                    {ticket.sla.resolved_at
                      ? new Date(ticket.sla.resolved_at).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Breach minutes</div>
                  <div>{ticket.sla.breach_minutes}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Credit</div>
                  <div>
                    {ticket.sla.credit_pct}%
                    {ticket.sla.credit_amount != null
                      ? ` · ${ticket.sla.credit_amount} ${ticket.sla.currency_code ?? ""}`
                      : ""}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No SLA record.</div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-xs uppercase text-muted-foreground">Apply SLA credit</div>
            <p className="text-xs text-muted-foreground">
              Response 5% + Resolution 10%, capped at 20% of the monthly O&amp;M fee.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="fee">Monthly O&amp;M fee</Label>
                <Input
                  id="fee"
                  type="number"
                  min={0}
                  step="0.01"
                  value={monthlyFee}
                  onChange={(e) => setMonthlyFee(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ccy">Currency</Label>
                <Input
                  id="ccy"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={
                creditMut.isPending ||
                Number.isNaN(Number.parseFloat(monthlyFee)) ||
                Number.parseFloat(monthlyFee) < 0
              }
              onClick={() =>
                creditMut.mutate({
                  ticket_id: ticket.id,
                  monthly_fee: Number.parseFloat(monthlyFee),
                  currency_code: currency || null!,
                })
              }
            >
              {creditMut.isPending ? "Applying…" : "Apply credit"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
