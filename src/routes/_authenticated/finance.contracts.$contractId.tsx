// P-078 — Contract detail: Overview / Schedule of Values / Obligations + AI extractor.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  FilePlus,
  FileText,
  Loader2,
  Receipt,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContractProjectSelect } from "@/components/finance/contract-project-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MilestoneBillDialog } from "@/components/finance/milestone-bill-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import {
  bulkInsertObligations,
  extractContractClauses,
  getContractFileUrl,
  markContractSigned,
  updateScheduleOfValues,
  upsertContract,
  upsertObligation,
  uploadSignedContract,
} from "@/lib/contracts.functions";
import {
  contractDetailQueryOptions,
  contractsAccessQueryOptions,
  contractErrorMessage,
} from "@/lib/contracts.query";
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ContractUpsertSchema,
  ObligationUpsertSchema,
  OBLIGATION_STATUSES,
  SIGNED_STATUSES,
  contractLabelForType,
  contractStatusLabel,
  isObligationOverdue,
  sovTotal,
  type ContractRow,
  type ContractStatus,
  type ExtractedObligation,
  type ObligationRow,
  type ObligationStatus,
  type SovLine,
} from "@/lib/contracts.rules";
// pdf-text-extractor dynamically imported inside handler (uses pdfjs-dist worker; browser-only)

export const Route = createFileRoute("/_authenticated/finance/contracts/$contractId")({
  head: () => ({
    meta: [
      { title: "Contract — GridMind EPC" },
      {
        name: "description",
        content:
          "Manage a contract's schedule of values, signed copy, and obligations, with AI-assisted clause extraction.",
      },
      { property: "og:title", content: "Contract — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContractDetail,
  errorComponent: DetailError,
});

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load contract</h2>
      <p className="text-sm text-muted-foreground">{contractErrorMessage(error)}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

function statusVariant(s: ContractStatus): "default" | "secondary" | "outline" | "destructive" {
  switch (s) {
    case "signed":
    case "active":
      return "default";
    case "completed":
      return "secondary";
    case "terminated":
      return "destructive";
    default:
      return "outline";
  }
}

function ContractDetail() {
  const { contractId } = Route.useParams();
  const detail = useSuspenseQuery(contractDetailQueryOptions(contractId));
  const access = useSuspenseQuery(contractsAccessQueryOptions());
  const { contract, obligations } = detail.data;
  const canWrite = access.data.canWrite;

  return (
    <div className="page-shell">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/finance/contracts">
            <ArrowLeft className="mr-1 size-4" /> Back to contracts
          </Link>
        </Button>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {contract.title}
            <Badge variant={statusVariant(contract.status)}>
              {contractStatusLabel(contract.status)}
            </Badge>
            {contract.retention_until && (
              <Badge variant="outline">Retention until {contract.retention_until}</Badge>
            )}
          </span>
        }
        description={`${contract.contract_number} · ${contract.counterparty} · ${contractLabelForType(contract.contract_type)}${
          contract.value != null
            ? ` · ${contract.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${contract.currency_code ?? ""}`
            : ""
        }`}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sov">Schedule of Values</TabsTrigger>
          <TabsTrigger value="obligations">
            Obligations{obligations.length ? ` (${obligations.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab contract={contract} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="sov" className="mt-4">
          <SovTab contract={contract} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="obligations" className="mt-4">
          <ObligationsTab contract={contract} obligations={obligations} canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
const OverviewFormSchema = ContractUpsertSchema.omit({ id: true });
type OverviewFormValues = z.infer<typeof OverviewFormSchema>;

function OverviewTab({ contract, canWrite }: { contract: ContractRow; canWrite: boolean }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertContract);
  const uploadFn = useServerFn(uploadSignedContract);
  const signFn = useServerFn(markContractSigned);
  const fileUrlFn = useServerFn(getContractFileUrl);

  const locked = SIGNED_STATUSES.includes(contract.status);
  const [signOpen, setSignOpen] = useState(false);

  const form = useForm<OverviewFormValues>({
    resolver: zodResolver(OverviewFormSchema),
    defaultValues: {
      title: contract.title,
      project_id: contract.project_id ?? null,
      contract_type: contract.contract_type,
      counterparty: contract.counterparty,
      status: contract.status,
      value: contract.value ?? undefined,
      currency_code: contract.currency_code ?? "USD",
      effective_date: contract.effective_date ?? null,
      expiry_date: contract.expiry_date ?? null,
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: OverviewFormValues) =>
      upsert({ data: { ...values, id: contract.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Contract updated");
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Contract details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input disabled={!canWrite} {...form.register("title")} />
            </div>
            <div className="space-y-1">
              <Label>Counterparty</Label>
              <Input disabled={!canWrite} {...form.register("counterparty")} />
            </div>
            <div className="space-y-1">
              <Label>Project</Label>
              <ContractProjectSelect
                disabled={!canWrite}
                value={form.watch("project_id") ?? null}
                onChange={(id) => form.setValue("project_id", id)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select
                  disabled={!canWrite || locked}
                  value={form.watch("contract_type")}
                  onValueChange={(v) => form.setValue("contract_type", v as any)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {contractLabelForType(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  disabled={!canWrite}
                  value={form.watch("status") ?? contract.status}
                  onValueChange={(v) => form.setValue("status", v as any)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {contractStatusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Input
                  disabled={!canWrite || locked}
                  maxLength={3}
                  {...form.register("currency_code")}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Value</Label>
                <Input
                  disabled={!canWrite || locked}
                  type="number"
                  step="0.01"
                  {...form.register("value", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1">
                <Label>Effective date</Label>
                <Input disabled={!canWrite} type="date" {...form.register("effective_date")} />
              </div>
              <div className="space-y-1">
                <Label>Expiry date</Label>
                <Input disabled={!canWrite} type="date" {...form.register("expiry_date")} />
              </div>
            </div>
            {locked && (
              <p className="text-xs text-muted-foreground">
                Financial fields are locked once the contract is signed. Create a new version to
                amend.
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={!canWrite || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed copy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SignedFilePanel
            contract={contract}
            canWrite={canWrite}
            uploadFn={uploadFn}
            fileUrlFn={fileUrlFn}
          />
          <Button
            className="w-full"
            variant={contract.status === "signed" ? "outline" : "default"}
            disabled={
              !canWrite || (contract.status !== "draft" && contract.status !== "negotiation")
            }
            onClick={() => setSignOpen(true)}
          >
            <CheckCircle2 className="mr-2 size-4" />
            {contract.signed_at ? "Signed" : "Mark signed"}
          </Button>
          {contract.signed_at && (
            <p className="text-xs text-muted-foreground">
              Signed {contract.signed_at} · retention until {contract.retention_until}
            </p>
          )}
        </CardContent>
      </Card>

      <MarkSignedDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        contract={contract}
        signFn={signFn}
      />
    </div>
  );
}

function SignedFilePanel({
  contract,
  canWrite,
  uploadFn,
  fileUrlFn,
}: {
  contract: ContractRow;
  canWrite: boolean;
  uploadFn: (args: any) => Promise<any>;
  fileUrlFn: (args: any) => Promise<{ url: string | null }>;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      await uploadFn({
        data: {
          contractId: contract.id,
          filename: file.name,
          contentBase64: base64,
          contentType: file.type || "application/pdf",
        },
      });
      await qc.invalidateQueries({ queryKey: ["contracts", "detail", contract.id] });
      toast.success("Signed copy uploaded");
    } catch (e) {
      toast.error(contractErrorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function openFile() {
    if (!contract.file_path) return;
    setLoadingUrl(true);
    try {
      const { url } = await fileUrlFn({ data: { id: contract.id } });
      if (url) {
        setSignedUrl(url);
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setLoadingUrl(false);
    }
  }

  return (
    <div className="space-y-2">
      {contract.file_path ? (
        <button
          onClick={openFile}
          className="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
        >
          <FileText className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate">{contract.file_path.split("/").pop()}</span>
          {loadingUrl ? <Loader2 className="size-4 animate-spin" /> : null}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">No signed copy uploaded.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        variant="outline"
        className="w-full"
        disabled={!canWrite || uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-2 size-4" />
        {uploading ? "Uploading…" : contract.file_path ? "Replace file" : "Upload signed PDF"}
      </Button>
      {signedUrl ? null : null}
    </div>
  );
}

function MarkSignedDialog({
  open,
  onOpenChange,
  contract,
  signFn,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contract: ContractRow;
  signFn: (args: any) => Promise<any>;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const mutation = useMutation({
    mutationFn: async () => signFn({ data: { id: contract.id, signed_at: date } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Contract marked signed — 7-year retention started");
      onOpenChange(false);
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark contract signed</DialogTitle>
          <DialogDescription>
            Requires a signed copy uploaded and Schedule of Values totalling the contract value.
            Sets retention_until to signed date + 7 years.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Signed date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Signing…" : "Confirm sign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Schedule of Values
// ---------------------------------------------------------------------------
function SovTab({ contract, canWrite }: { contract: ContractRow; canWrite: boolean }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateScheduleOfValues);
  const [billOpen, setBillOpen] = useState(false);
  const canBill =
    canWrite &&
    ["signed", "active"].includes(contract.status) &&
    (contract.schedule_of_values?.length ?? 0) > 0;
  const [lines, setLines] = useState<SovLine[]>(() =>
    contract.schedule_of_values.length
      ? contract.schedule_of_values
      : [{ line_no: 1, description: "", scheduled_amount: 0 }],
  );

  const total = useMemo(() => sovTotal(lines), [lines]);
  const target = contract.value ?? 0;
  const diff = total - target;
  const matches = contract.value == null || Math.abs(diff) < 0.01;

  const mutation = useMutation({
    mutationFn: async () =>
      updateFn({
        data: {
          id: contract.id,
          lines: lines.map((l, i) => ({ ...l, line_no: i + 1 })),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts", "detail", contract.id] });
      toast.success("Schedule of Values saved");
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  function updateLine(i: number, patch: Partial<SovLine>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((cur) => [...cur, { line_no: cur.length + 1, description: "", scheduled_amount: 0 }]);
  }
  function removeLine(i: number) {
    setLines((cur) => cur.filter((_, idx) => idx !== i));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule of Values</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Line</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-40 text-right">Scheduled amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <Input
                    disabled={!canWrite}
                    value={l.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    disabled={!canWrite}
                    type="number"
                    step="0.01"
                    className="text-right"
                    value={l.scheduled_amount}
                    onChange={(e) =>
                      updateLine(i, {
                        scheduled_amount: Number(e.target.value) || 0,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canWrite || lines.length === 1}
                    onClick={() => removeLine(i)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!canWrite} onClick={addLine}>
              <FilePlus className="mr-2 size-4" /> Add line
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canBill}
              onClick={() => setBillOpen(true)}
              title={
                canBill
                  ? "Create a draft receivable invoice against a SOV line"
                  : "Contract must be signed and the SOV saved to bill milestones"
              }
            >
              <Receipt className="mr-2 size-4" /> Bill milestone
            </Button>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total vs contract value</div>
            <div
              className={cn(
                "font-mono tabular-nums",
                matches ? "text-foreground" : "text-destructive",
              )}
            >
              {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} /{" "}
              {target.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              {contract.currency_code ? ` ${contract.currency_code}` : ""}
            </div>
            {!matches && (
              <div className="text-xs text-destructive">
                Δ {diff.toLocaleString(undefined, { maximumFractionDigits: 2 })} — must be zero to
                save
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!canWrite || !matches || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save SOV"}
          </Button>
        </div>
      </CardContent>
      <MilestoneBillDialog contractId={contract.id} open={billOpen} onOpenChange={setBillOpen} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------
function ObligationsTab({
  contract,
  obligations,
  canWrite,
}: {
  contract: ContractRow;
  obligations: ObligationRow[];
  canWrite: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);

  const editingRow = obligations.find((o) => o.id === editingId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {obligations.length} obligation{obligations.length === 1 ? "" : "s"} tracked
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={!canWrite} onClick={() => setExtractOpen(true)}>
            <Sparkles className="mr-2 size-4" /> Extract clauses with AI
          </Button>
          <Button disabled={!canWrite} onClick={() => setCreating(true)}>
            <FilePlus className="mr-2 size-4" /> Add obligation
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border">
        {obligations.length === 0 ? (
          <EmptyState
            icon={FilePlus}
            title="No obligations yet"
            description="Add manually or extract with AI."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Clause</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {obligations.map((o) => {
                const overdue = isObligationOverdue(o.due_date, o.status);
                return (
                  <TableRow
                    key={o.id}
                    onClick={() => canWrite && setEditingId(o.id)}
                    className={cn(
                      canWrite && "cursor-pointer",
                      overdue && "bg-destructive/10 text-destructive",
                    )}
                  >
                    <TableCell className="max-w-[280px] truncate">{o.title}</TableCell>
                    <TableCell className="font-mono text-xs">{o.clause_ref ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{o.due_date ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          o.status === "fulfilled"
                            ? "default"
                            : o.status === "breached"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {o.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {o.extracted_by_ai ? (
                        <Badge variant="secondary">
                          <Sparkles className="mr-1 size-3" /> AI
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Manual</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {(creating || editingRow) && (
        <ObligationDialog
          contractId={contract.id}
          existing={editingRow}
          onDone={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {extractOpen && (
        <ExtractClausesDialog contract={contract} onClose={() => setExtractOpen(false)} />
      )}
    </div>
  );
}

const ObligationFormSchema = ObligationUpsertSchema.omit({ contract_id: true, id: true });
type ObligationFormValues = z.infer<typeof ObligationFormSchema>;

function ObligationDialog({
  contractId,
  existing,
  onDone,
}: {
  contractId: string;
  existing: ObligationRow | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertObligation);
  const form = useForm<ObligationFormValues>({
    resolver: zodResolver(ObligationFormSchema),
    defaultValues: {
      title: existing?.title ?? "",
      description: existing?.description ?? "",
      clause_ref: existing?.clause_ref ?? "",
      due_date: existing?.due_date ?? null,
      status: existing?.status ?? "open",
    },
  });
  const mutation = useMutation({
    mutationFn: async (values: ObligationFormValues) =>
      upsertFn({
        data: { ...values, contract_id: contractId, id: existing?.id },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts", "detail", contractId] });
      toast.success(existing ? "Obligation updated" : "Obligation added");
      onDone();
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit obligation" : "New obligation"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input {...form.register("title")} />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea {...form.register("description")} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Clause reference</Label>
              <Input placeholder="Clause 8.2" {...form.register("clause_ref")} />
            </div>
            <div className="space-y-1">
              <Label>Due date</Label>
              <Input type="date" {...form.register("due_date")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select
              value={form.watch("status") ?? "open"}
              onValueChange={(v) => form.setValue("status", v as ObligationStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBLIGATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AI clause extractor dialog
// ---------------------------------------------------------------------------
type ExtractedRow = ExtractedObligation & { selected: boolean };

function ExtractClausesDialog({
  contract,
  onClose,
}: {
  contract: ContractRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const extractFn = useServerFn(extractContractClauses);
  const bulkFn = useServerFn(bulkInsertObligations);

  const [source, setSource] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractedRow[] | null>(null);

  async function runExtract() {
    setExtracting(true);
    setError(null);
    setItems(null);
    try {
      let text = "";
      if (source === "file") {
        if (!file) throw new Error("Choose a PDF file first.");
        const { extractPdfText } = await import("@/lib/pdf-text-extractor");
        text = await extractPdfText(file);
        if (text.trim().length < 20) {
          throw new Error("Couldn’t extract enough text from that PDF.");
        }
      } else {
        text = pasted;
        if (text.trim().length < 20) throw new Error("Paste at least a paragraph of text.");
      }
      const { obligations } = await extractFn({
        data: { contract_id: contract.id, pdf_text: text },
      });
      if (obligations.length === 0) {
        setError("The AI didn’t find any obligations in that text.");
      } else {
        setItems(obligations.map((o) => ({ ...o, selected: true })));
      }
    } catch (e) {
      setError(contractErrorMessage(e));
    } finally {
      setExtracting(false);
    }
  }

  const accept = useMutation({
    mutationFn: async () => {
      if (!items) return { count: 0 };
      const chosen = items.filter((i) => i.selected).map(({ selected, ...rest }) => rest);
      if (chosen.length === 0) throw new Error("Select at least one obligation.");
      return bulkFn({
        data: { contract_id: contract.id, items: chosen },
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["contracts", "detail", contract.id] });
      toast.success(`Imported ${res.count} obligation${res.count === 1 ? "" : "s"}`);
      onClose();
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  const selectedCount = items?.filter((i) => i.selected).length ?? 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Extract clauses with AI
          </DialogTitle>
          <DialogDescription>
            The AI reads the contract text and suggests obligations. You choose which ones to import
            — nothing is added automatically.
          </DialogDescription>
        </DialogHeader>

        {!items && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={source === "file" ? "default" : "outline"}
                size="sm"
                onClick={() => setSource("file")}
              >
                Upload PDF
              </Button>
              <Button
                variant={source === "paste" ? "default" : "outline"}
                size="sm"
                onClick={() => setSource("paste")}
              >
                Paste text
              </Button>
            </div>
            {source === "file" ? (
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            ) : (
              <Textarea
                rows={8}
                placeholder="Paste the contract text here…"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            )}
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Extraction failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button onClick={runExtract} disabled={extracting}>
                {extracting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Extracting…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 size-4" /> Extract
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {items && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {items.length} suggestion{items.length === 1 ? "" : "s"} — review and choose which to
              import. {selectedCount} selected.
            </p>
            <div className="max-h-[380px] space-y-2 overflow-y-auto">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <Checkbox
                    checked={it.selected}
                    onCheckedChange={(v) =>
                      setItems((cur) =>
                        cur
                          ? cur.map((r, idx) => (idx === i ? { ...r, selected: Boolean(v) } : r))
                          : cur,
                      )
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{it.title}</div>
                      {it.clause_ref && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {it.clause_ref}
                        </span>
                      )}
                    </div>
                    {it.description && (
                      <p className="text-sm text-muted-foreground">{it.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <Label className="text-xs">Due</Label>
                      <Input
                        type="date"
                        className="h-7 w-40"
                        value={it.due_date ?? ""}
                        onChange={(e) =>
                          setItems((cur) =>
                            cur
                              ? cur.map((r, idx) =>
                                  idx === i ? { ...r, due_date: e.target.value || null } : r,
                                )
                              : cur,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Import failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setItems(null)}>
                Re-extract
              </Button>
              <Button
                onClick={() => accept.mutate()}
                disabled={accept.isPending || selectedCount === 0}
              >
                {accept.isPending ? "Importing…" : `Import ${selectedCount} selected`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
