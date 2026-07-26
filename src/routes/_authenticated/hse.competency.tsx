// P-185 — Competency & certification register with expiry badges.
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Paperclip, Plus } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, ExpiryBadge, HseRegister } from "@/components/hse/hse-ext-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  createCompetencyRecord,
  getHseStoragePrefix,
  listCompetencyRecords,
} from "@/lib/hse-ext.functions";
import { expiryState } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/competency")({
  head: () => ({
    meta: [
      { title: "Competency records — GridMind EPC" },
      {
        name: "description",
        content: "Worker competencies and certificates with expiry tracking and document evidence.",
      },
      { property: "og:title", content: "Competency records — GridMind EPC" },
      {
        property: "og:description",
        content: "Know who is certified for what, and what expires in the next 30 days.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompetencyPage,
});

type CompRow = {
  id: string;
  worker_name: string;
  employer: string | null;
  competency: string;
  certificate_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  file_path: string | null;
};

function CompetencyPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [employer, setEmployer] = useState("");
  const [competency, setCompetency] = useState("");
  const [certificateNumber, setCertificateNumber] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const prefixFn = useServerFn(getHseStoragePrefix);
  const prefix = useQuery({ queryKey: ["hse-storage-prefix"], queryFn: () => prefixFn() });

  const listFn = useServerFn(listCompetencyRecords);
  const key = ["hse", "competency", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<CompRow[]>,
    enabled: Boolean(activeProject),
  });

  const createFn = useServerFn(createCompetencyRecord);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          workerName: workerName.trim(),
          employer: employer.trim() || null,
          competency: competency.trim(),
          certificateNumber: certificateNumber.trim() || null,
          issuedDate: issuedDate || null,
          expiryDate: expiryDate || null,
          filePath,
        },
      }),
    onSuccess: () => {
      toast.success("Competency recorded");
      setWorkerName("");
      setCompetency("");
      setCertificateNumber("");
      setFilePath(null);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onPickCertificate(file: File | undefined) {
    const companyId = prefix.data?.companyId;
    if (!file || !companyId) return;
    setUploading(true);
    try {
      const path = `${companyId}/hse/competency/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("documents").upload(path, file);
      if (error) throw error;
      setFilePath(path);
      toast.success("Certificate attached");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) =>
      [r.worker_name, r.competency, r.employer ?? "", r.certificate_number ?? ""].some((v) =>
        v.toLowerCase().includes(term),
      ),
    );
  }, [list.data, search]);

  const expiringSoon = rows.filter((r) => expiryState(r.expiry_date) === "expiring").length;

  return (
    <div className="page-shell">
      <PageHeader
        title="Competency"
        description="Certificates, tickets and licences — with expiry visibility before it bites."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Record a competency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-worker">Worker</Label>
              <Input id="c-worker" value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-employer">Employer</Label>
              <Input id="c-employer" value={employer} onChange={(e) => setEmployer(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-comp">Competency</Label>
              <Input id="c-comp" value={competency} onChange={(e) => setCompetency(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-cert">Certificate no.</Label>
              <Input
                id="c-cert"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-issued">Issued</Label>
              <Input
                id="c-issued"
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-expiry">Expires</Label>
              <Input
                id="c-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => void onPickCertificate(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={14} aria-hidden /> {filePath ? "Certificate attached" : "Attach certificate"}
            </Button>
            <Button
              size="sm"
              disabled={!workerName.trim() || !competency.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={14} aria-hidden /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">Expiring within 30 days: {expiringSoon}</p>

      <HseRegister
        title="Register"
        icon={BadgeCheck}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="competency.csv"
            headers={["Worker", "Employer", "Competency", "Certificate", "Issued", "Expires"]}
            rows={rows.map((r) => [
              r.worker_name,
              r.employer ?? "",
              r.competency,
              r.certificate_number ?? "",
              r.issued_date ?? "",
              r.expiry_date ?? "",
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No competency records"
        emptyDescription="Record the first worker certificate."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Employer</TableHead>
              <TableHead>Competency</TableHead>
              <TableHead>Certificate</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.worker_name}</TableCell>
                <TableCell className="text-muted-foreground">{r.employer ?? "—"}</TableCell>
                <TableCell>{r.competency}</TableCell>
                <TableCell>{r.certificate_number ?? "—"}</TableCell>
                <TableCell>
                  <ExpiryBadge expiry={r.expiry_date} />
                </TableCell>
                <TableCell>{r.file_path ? "Attached" : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
