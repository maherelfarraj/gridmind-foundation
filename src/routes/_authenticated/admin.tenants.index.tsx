import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Building2 } from "lucide-react";

import { createTenant, listTenants, type PlanTier, type TenantRow } from "@/lib/tenants.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/tenants/")({
  head: () => ({
    meta: [
      { title: "Tenants | GridMind EPC Admin" },
      { name: "description", content: "Super admin console for managing GridMind EPC tenants." },
      { property: "og:title", content: "Tenants | GridMind EPC Admin" },
      {
        property: "og:description",
        content: "Super admin console for managing GridMind EPC tenants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TenantsPage,
  errorComponent: TenantsError,
  notFoundComponent: TenantsNotFound,
});

function TenantsNotFound() {
  const { t } = useI18n();
  return <div className="p-8 text-sm text-muted-foreground">{t("adminMod.tenantsPage.notFound")}</div>;
}

function TenantsError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Card className="m-6">
      <CardHeader>
        <CardTitle>{t("adminMod.tenantsPage.errorTitle")}</CardTitle>
        <CardDescription>{error.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          {t("adminMod.tenantsPage.retry")}
        </Button>
      </CardContent>
    </Card>
  );
}

function PlanBadge({ tier }: { tier: PlanTier }) {
  const { t } = useI18n();
  const variant = tier === "enterprise" ? "default" : tier === "growth" ? "secondary" : "outline";
  const label = t(`adminMod.tenantsPage.plan.${tier}`);
  return <Badge variant={variant}>{label}</Badge>;
}

const createSchema = z.object({
  legalName: z.string().trim().min(1, "Required").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Required")
    .max(20, "Max 20 characters")
    .regex(/^[a-z0-9-]+$/i, "Letters, numbers, hyphens only"),
  contactEmail: z.string().trim().toLowerCase().email("Invalid email"),
  planTier: z.enum(["starter", "growth", "enterprise"]),
});
type CreateFormValues = z.infer<typeof createSchema>;

function TenantsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useMemo(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const listFn = useServerFn(listTenants);
  const query = useQuery({
    queryKey: ["admin", "tenants", debounced],
    queryFn: () => listFn({ data: debounced ? { search: debounced } : {} }),
  });

  return (
    <div className="page-shell max-w-6xl">
      <PageHeader
        title={t("adminMod.admin.tenants")}
        description={t("adminMod.tenantsPage.description")}
        actions={<CreateTenantDialog />}
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("adminMod.tenantsPage.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminMod.tenantsPage.colLegalName")}</TableHead>
                <TableHead>{t("adminMod.tenantsPage.colShortName")}</TableHead>
                <TableHead>{t("adminMod.tenantsPage.colContactEmail")}</TableHead>
                <TableHead>{t("adminMod.tenantsPage.colPlan")}</TableHead>
                <TableHead className="text-right">{t("adminMod.tenantsPage.colMembers")}</TableHead>
                <TableHead>{t("adminMod.tenantsPage.colCreated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : query.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-destructive">
                    {(query.error as Error).message}
                    <div className="mt-3">
                      <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                        {t("adminMod.tenantsPage.retry")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (query.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="border-0 bg-transparent p-0">
                    <EmptyState
                      icon={Building2}
                      title={t("adminMod.tenantsPage.emptyTitle")}
                      compact
                      className="border-0 bg-transparent"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                (query.data ?? []).map((t: TenantRow) => (
                  <TableRow key={t.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        to="/admin/tenants/$companyId"
                        params={{ companyId: t.id }}
                        className="hover:underline"
                      >
                        {t.legal_name ?? t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.name}</TableCell>
                    <TableCell className="text-sm">{t.contact_email ?? "—"}</TableCell>
                    <TableCell>
                      <PlanBadge tier={t.plan_tier} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.member_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateTenantDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const createFn = useServerFn(createTenant);
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { legalName: "", slug: "", contactEmail: "", planTier: "starter" },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateFormValues) => createFn({ data: values }),
    onSuccess: () => {
      toast.success(t("adminMod.tenantsPage.create.successToast"));
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      form.reset();
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message || t("adminMod.tenantsPage.create.errorToast")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {t("adminMod.tenantsPage.create.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("adminMod.tenantsPage.create.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("adminMod.tenantsPage.create.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="legalName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("adminMod.tenantsPage.create.legalNameLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("adminMod.tenantsPage.create.legalNamePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("adminMod.tenantsPage.create.shortNameLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("adminMod.tenantsPage.create.shortNamePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("adminMod.tenantsPage.create.contactEmailLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" placeholder={t("adminMod.tenantsPage.create.contactEmailPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="planTier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("adminMod.tenantsPage.create.planTierLabel")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="starter">{t("adminMod.tenantsPage.plan.starter")}</SelectItem>
                      <SelectItem value="growth">{t("adminMod.tenantsPage.plan.growth")}</SelectItem>
                      <SelectItem value="enterprise">{t("adminMod.tenantsPage.plan.enterprise")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("adminMod.tenantsPage.create.cancel")}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("adminMod.tenantsPage.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
