// P-063 — New RFQ (draft) page.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

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
import { PageHeader } from "@/components/ui/page-header";
import { RfqLineEditor, type RfqDraftFormValues } from "@/components/procurement/rfq-line-editor";
import { listProjectsForRfq } from "@/lib/rfq.functions";
import { rfqProjectsQueryOptions, useSaveRfqDraft } from "@/lib/rfq-query";

export const Route = createFileRoute("/_authenticated/procurement/rfqs/new")({
  head: () => ({
    meta: [
      { title: "New RFQ — GridMind EPC" },
      {
        name: "description",
        content: "Draft a new request for quotation for a GridMind EPC project.",
      },
    ],
  }),
  component: NewRfq,
});

function NewRfq() {
  const navigate = useNavigate();
  const projectsFn = useServerFn(listProjectsForRfq);
  const projectsQuery = useSuspenseQuery(rfqProjectsQueryOptions(projectsFn));
  const saveDraft = useSaveRfqDraft();

  const form = useForm<RfqDraftFormValues>({
    defaultValues: {
      title: "",
      projectId: projectsQuery.data[0]?.id ?? "",
      currencyCode: projectsQuery.data[0]?.currency_code ?? "USD",
      issueDate: null,
      dueDate: null,
      terms: null,
      description: null,
      lines: [
        {
          line_no: 1,
          description: "",
          spec: null,
          qty: 1,
          uom: "pcs",
          target_price: null,
          site_need_date: null,
        },
      ],
    },
  });

  async function onSubmit(values: RfqDraftFormValues) {
    if (!values.projectId) return;
    const res = await saveDraft.mutateAsync({
      projectId: values.projectId,
      title: values.title,
      description: values.description,
      currencyCode: values.currencyCode.toUpperCase(),
      issueDate: values.issueDate,
      dueDate: values.dueDate,
      terms: values.terms,
      lines: values.lines.map((l) => ({
        line_no: Number(l.line_no),
        description: l.description,
        spec: l.spec,
        qty: Number(l.qty),
        uom: l.uom,
        target_price:
          l.target_price == null || Number.isNaN(Number(l.target_price))
            ? null
            : Number(l.target_price),
        site_need_date: l.site_need_date,
      })),
    });
    navigate({ to: "/procurement/rfqs/$rfqId", params: { rfqId: res.id } });
  }

  const projects = projectsQuery.data;

  return (
    <div className="page-shell max-w-5xl">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/rfqs" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to RFQs
        </Button>
        <PageHeader title="New RFQ" description="Draft an RFQ, then invite vendors and issue it." />
      </div>

      <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label>Title</Label>
            <Input
              {...form.register("title", { required: true, minLength: 2 })}
              placeholder="e.g. Central inverter package — GM-004"
            />
          </div>
          <div className="space-y-1">
            <Label>Project</Label>
            <Select
              value={form.watch("projectId")}
              onValueChange={(v) => {
                form.setValue("projectId", v);
                const proj = projects.find((p) => p.id === v);
                if (proj?.currency_code) form.setValue("currencyCode", proj.currency_code);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Input
              maxLength={3}
              {...form.register("currencyCode", {
                required: true,
                setValueAs: (v) => String(v ?? "").toUpperCase(),
              })}
            />
          </div>
          <div className="space-y-1">
            <Label>Issue date</Label>
            <Input
              type="date"
              {...form.register("issueDate", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
            />
          </div>
          <div className="space-y-1">
            <Label>Due date</Label>
            <Input
              type="date"
              {...form.register("dueDate", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Terms</Label>
            <Textarea
              rows={3}
              {...form.register("terms", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
              placeholder="Delivery Incoterms, payment terms, warranties…"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Description</Label>
            <Textarea
              rows={2}
              {...form.register("description", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Lines</h2>
          <RfqLineEditor control={form.control} />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/procurement/rfqs" })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saveDraft.isPending}>
            {saveDraft.isPending ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </form>
    </div>
  );
}
