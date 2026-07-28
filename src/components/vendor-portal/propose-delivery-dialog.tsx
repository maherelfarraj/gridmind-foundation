// P-224 — Shared vendor "Propose delivery" control (per PO line).
import { useState } from "react";
import { CalendarClock, CheckCircle2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  isCounterProposedNote,
  parsePoLines,
  validateProposedDate,
  type PoLine,
} from "@/lib/vendor-portal.rules";
import type { VendorLineEtaRow, VendorPoRow } from "@/lib/vendor-portal.functions";

export interface ProposeLineInput {
  line_no: number;
  proposed_date: string;
  proposed_qty?: number | null;
  note?: string | null;
}

interface DraftRow {
  line_no: number;
  proposed_date: string;
  proposed_qty: string;
  note: string;
}

/** ISO date (YYYY-MM-DD) of the PO issue timestamp, if any. */
export function issueDateOf(po: VendorPoRow): string | null {
  const raw = po.issued_at ?? null;
  return raw ? raw.slice(0, 10) : null;
}

/** Never implies confirmation: a vendor proposal stays "pending buyer confirmation". */
export function ConfirmationChip({ eta }: { eta: VendorLineEtaRow | undefined }) {
  const { t } = useI18n();
  if (!eta?.current_eta) {
    return <span className="text-xs text-muted-foreground">{t("portalMod.propose.noEtaProposed")}</span>;
  }
  if (eta.eta_confirmed) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t("portalMod.propose.etaConfirmed")}
      </Badge>
    );
  }
  if (isCounterProposedNote(eta.notes)) {
    return (
      <Badge className="bg-accent text-accent-foreground">
        {t("portalMod.propose.counterProposed")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <CalendarClock className="h-3 w-3" />
      {t("portalMod.propose.pendingBuyerConfirmation")}
    </Badge>
  );
}

export function ProposeDeliveryDialog({
  po,
  etaByKey,
  submitting,
  onClose,
  onSubmit,
}: {
  po: VendorPoRow | null;
  etaByKey: Map<string, VendorLineEtaRow>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (poId: string, poIssueDate: string | null, lines: ProposeLineInput[]) => void;
}) {
  const { t } = useI18n();
  const lines: PoLine[] = po ? parsePoLines(po.lines) : [];
  const issueDate = po ? issueDateOf(po) : null;
  const [draft, setDraft] = useState<Record<number, DraftRow>>({});
  const [touchedPo, setTouchedPo] = useState<string | null>(null);

  if (po && touchedPo !== po.id) {
    setTouchedPo(po.id);
    setDraft(
      Object.fromEntries(
        lines.map((l) => [
          l.line_no,
          {
            line_no: l.line_no,
            proposed_date: etaByKey.get(`${po.id}:${l.line_no}`)?.current_eta ?? "",
            proposed_qty: "",
            note: "",
          } satisfies DraftRow,
        ]),
      ),
    );
  }

  const rows = Object.values(draft).filter((r) => r.proposed_date.trim() !== "");
  const errors = rows.map((r) => validateProposedDate(r.proposed_date, issueDate));
  const firstError = errors.find(Boolean) ?? null;

  return (
    <Dialog open={!!po} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("portalMod.propose.dialogTitle", { po: po?.po_number })}</DialogTitle>
          <DialogDescription>
            {t("portalMod.propose.dialogDescription")}
            {issueDate ? t("portalMod.propose.issueDateNote", { date: issueDate }) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">{t("portalMod.propose.colLine")}</TableHead>
                <TableHead>{t("portalMod.propose.colDescription")}</TableHead>
                <TableHead className="w-44">{t("portalMod.propose.colProposedDate")}</TableHead>
                <TableHead className="w-28">{t("portalMod.propose.colQty")}</TableHead>
                <TableHead>{t("portalMod.propose.colNote")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const row = draft[l.line_no];
                const err = row?.proposed_date
                  ? validateProposedDate(row.proposed_date, issueDate)
                  : null;
                return (
                  <TableRow key={l.line_no}>
                    <TableCell className="font-mono text-xs">{l.line_no}</TableCell>
                    <TableCell className="text-sm">{l.description}</TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        min={issueDate ?? undefined}
                        value={row?.proposed_date ?? ""}
                        aria-label={t("portalMod.propose.proposedDateAriaLabel", { line: l.line_no })}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: {
                              ...(d[l.line_no] ?? {
                                line_no: l.line_no,
                                proposed_qty: "",
                                note: "",
                                proposed_date: "",
                              }),
                              proposed_date: e.target.value,
                            },
                          }))
                        }
                        className="h-8"
                      />
                      {err ? (
                        <p className="pt-1 text-[10px] text-destructive">
                          {t(`portalMod.errors.${err}`)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={row?.proposed_qty ?? ""}
                        aria-label={t("portalMod.propose.proposedQtyAriaLabel", { line: l.line_no })}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: { ...d[l.line_no], proposed_qty: e.target.value },
                          }))
                        }
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row?.note ?? ""}
                        maxLength={500}
                        aria-label={t("portalMod.propose.noteAriaLabel", { line: l.line_no })}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: { ...d[l.line_no], note: e.target.value },
                          }))
                        }
                        className="h-8"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("portalMod.propose.cancel")}
          </Button>
          <Button
            disabled={submitting || rows.length === 0 || !!firstError}
            onClick={() =>
              po &&
              onSubmit(
                po.id,
                issueDate,
                rows.map((r) => ({
                  line_no: r.line_no,
                  proposed_date: r.proposed_date,
                  proposed_qty: r.proposed_qty.trim() === "" ? null : Number(r.proposed_qty),
                  note: r.note.trim() === "" ? null : r.note.trim(),
                })),
              )
            }
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("portalMod.propose.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
