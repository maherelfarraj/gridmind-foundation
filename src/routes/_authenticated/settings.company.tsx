import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";

import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";
import {
  getCompanySettings,
  updateCompanyDetails,
  upsertCompanyBranding,
  getLogoUploadTarget,
  setCompanyLogo,
  removeCompanyLogo,
} from "@/lib/company.functions";

export const Route = createFileRoute("/_authenticated/settings/company")({
  head: () => ({
    meta: [
      { title: "Company settings — GridMind EPC" },
      {
        name: "description",
        content:
          "Update your GridMind EPC company details and branding used across proposal exports.",
      },
      { property: "og:title", content: "Company settings — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Update your GridMind EPC company details and branding used across proposal exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsCompanyPage,
});

const hexRegex = /^#[0-9a-fA-F]{6}$/;

const detailsFormSchema = z.object({
  legal_name: z.string().trim().min(1, "Required").max(200),
  contact_email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
});
type DetailsForm = z.infer<typeof detailsFormSchema>;

const brandingFormSchema = z.object({
  primary_color: z.string().regex(hexRegex, "Must be #RRGGBB"),
  accent_color: z.string().regex(hexRegex, "Must be #RRGGBB"),
  footer_text: z.string().trim().max(500).optional().or(z.literal("")),
});
type BrandingForm = z.infer<typeof brandingFormSchema>;

function SettingsCompanyPage() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getCompanySettings);
  const fetchRoles = useServerFn(getCurrentUserRoles);

  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => fetchSettings(),
  });

  const rolesQuery = useQuery({
    queryKey: ["current-user-roles"],
    queryFn: () => fetchRoles({ data: {} }),
  });

  const isAdmin = useMemo(
    () =>
      (rolesQuery.data ?? []).some(
        (r) => r.role === "company_admin" || r.role === "super_admin",
      ),
    [rolesQuery.data],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["company-settings"] });

  if (settingsQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Couldn't load company settings
            </CardTitle>
            <CardDescription>
              {(settingsQuery.error as Error | undefined)?.message ??
                "Something went wrong."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => settingsQuery.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { company, branding, logoSignedUrl } = settingsQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Company settings
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Edit your company profile and branding. All members can view; only company admins can save changes."
            : "View-only. Only company admins can edit these settings."}
        </p>
      </div>

      <CompanyDetailsCard
        company={company}
        isAdmin={isAdmin}
        onSaved={invalidate}
      />

      <BrandingCard
        branding={branding}
        logoSignedUrl={logoSignedUrl}
        isAdmin={isAdmin}
        onSaved={invalidate}
      />
    </div>
  );
}

function CompanyDetailsCard({
  company,
  isAdmin,
  onSaved,
}: {
  company: {
    legal_name: string | null;
    contact_email: string | null;
    phone: string | null;
    address: string | null;
  };
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const submitFn = useServerFn(updateCompanyDetails);

  const form = useForm<DetailsForm>({
    resolver: zodResolver(detailsFormSchema),
    defaultValues: {
      legal_name: company.legal_name ?? "",
      contact_email: company.contact_email ?? "",
      phone: company.phone ?? "",
      address: company.address ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: DetailsForm) =>
      submitFn({
        data: {
          legal_name: values.legal_name,
          contact_email: values.contact_email,
          phone: values.phone?.trim() ? values.phone : null,
          address: values.address?.trim() ? values.address : null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.changed === 0 ? "No changes to save" : "Company details saved",
      );
      form.reset(form.getValues());
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to save"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company details</CardTitle>
        <CardDescription>
          Legal identity and primary contact for this tenant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <FormField
              control={form.control}
              name="legal_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Legal name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!isAdmin} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contact_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} disabled={!isAdmin} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!isAdmin} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} disabled={!isAdmin} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  !isAdmin || !form.formState.isDirty || mutation.isPending
                }
              >
                {mutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save details
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function BrandingCard({
  branding,
  logoSignedUrl,
  isAdmin,
  onSaved,
}: {
  branding: {
    primary_color: string | null;
    accent_color: string | null;
    footer_text: string | null;
  } | null;
  logoSignedUrl: string | null;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const submitFn = useServerFn(upsertCompanyBranding);
  const getTargetFn = useServerFn(getLogoUploadTarget);
  const setLogoFn = useServerFn(setCompanyLogo);
  const removeLogoFn = useServerFn(removeCompanyLogo);

  const [logoPreview, setLogoPreview] = useState<string | null>(logoSignedUrl);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLogoPreview(logoSignedUrl);
  }, [logoSignedUrl]);

  const form = useForm<BrandingForm>({
    resolver: zodResolver(brandingFormSchema),
    defaultValues: {
      primary_color: branding?.primary_color ?? "#1e40af",
      accent_color: branding?.accent_color ?? "#0d9488",
      footer_text: branding?.footer_text ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: BrandingForm) =>
      submitFn({
        data: {
          primary_color: values.primary_color,
          accent_color: values.accent_color,
          footer_text: values.footer_text?.trim() ? values.footer_text : null,
        },
      }),
    onSuccess: () => {
      toast.success("Branding saved");
      form.reset(form.getValues());
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to save"),
  });

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be 2 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const target = await getTargetFn();
      const localPreview = URL.createObjectURL(file);
      setLogoPreview(localPreview);
      const { error } = await supabase.storage
        .from(target.bucket)
        .upload(target.path, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "0",
        });
      if (error) throw error;
      const res = await setLogoFn({ data: { path: target.path } });
      if (res.signedUrl) setLogoPreview(res.signedUrl);
      toast.success("Logo uploaded");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const removeMutation = useMutation({
    mutationFn: () => removeLogoFn(),
    onSuccess: () => {
      setLogoPreview(null);
      toast.success("Logo removed");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to remove"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Branding is applied to proposal PDF/PPTX exports.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Company logo preview"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isAdmin || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {logoPreview ? "Replace logo" : "Upload logo"}
              </Button>
              {logoPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!isAdmin || removeMutation.isPending}
                  onClick={() => removeMutation.mutate()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                PNG, JPG or SVG. Max 2 MB.
              </p>
            </div>
          </div>
        </div>

        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                control={form.control}
                name="primary_color"
                label="Primary color"
                disabled={!isAdmin}
              />
              <ColorField
                control={form.control}
                name="accent_color"
                label="Accent color"
                disabled={!isAdmin}
              />
            </div>
            <FormField
              control={form.control}
              name="footer_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Footer text</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Appears in exported PDF/PPTX footers"
                      {...field}
                      disabled={!isAdmin}
                    />
                  </FormControl>
                  <FormDescription>
                    Shown on exported documents.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  !isAdmin || !form.formState.isDirty || mutation.isPending
                }
              >
                {mutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save branding
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function ColorField({
  control,
  name,
  label,
  disabled,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  name: "primary_color" | "accent_color";
  label: string;
  disabled: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <input
                type="color"
                value={hexRegex.test(field.value) ? field.value : "#000000"}
                onChange={(e) => field.onChange(e.target.value)}
                disabled={disabled}
                aria-label={`${label} picker`}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormControl>
            <Input
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              disabled={disabled}
              maxLength={7}
              className="font-mono uppercase"
            />
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
