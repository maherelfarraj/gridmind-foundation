// P-061 — Vendor identity form (create + edit).
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

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
import {
  listCurrencyCodes,
  PAYMENT_TERMS,
  INCOTERMS,
  type VendorRow,
} from "@/lib/vendors.functions";
import {
  currencyCodesQueryOptions,
  type VendorIdentityInput,
} from "@/lib/vendors-query";

const paymentTerms = z.enum(PAYMENT_TERMS);
const incoterms = z.enum(INCOTERMS);

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(160),
  legal_name: z.string().trim().max(200).optional(),
  tax_id: z.string().trim().max(60).optional(),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "Must be a URL")
    .optional(),
  email: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v === "" || /.+@.+\..+/.test(v), "Invalid email")
    .optional(),
  phone: z.string().trim().max(60).optional(),
  address_line: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  currency_code: z.string().trim().min(3).max(3).optional().or(z.literal("")),
  payment_terms: paymentTerms.optional(),
  incoterms: incoterms.optional(),
  categories: z.string().trim().max(400).optional(), // comma-separated in form
  notes: z.string().trim().max(2000).optional(),
});

export type VendorFormValues = z.infer<typeof schema>;

interface Props {
  initial?: VendorRow | null;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (input: VendorIdentityInput) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

function toFormValues(row: VendorRow | null | undefined): VendorFormValues {
  return {
    name: row?.name ?? "",
    legal_name: row?.legal_name ?? "",
    tax_id: row?.tax_id ?? "",
    website: row?.website ?? "",
    email: row?.email ?? "",
    phone: row?.phone ?? "",
    address_line: row?.address_line ?? "",
    city: row?.city ?? "",
    country: row?.country ?? "",
    currency_code: row?.currency_code ?? "",
    payment_terms: (row?.payment_terms as any) ?? "net_30",
    incoterms: (row?.incoterms as any) ?? "DAP",
    categories: (row?.categories ?? []).join(", "),
    notes: row?.notes ?? "",
  };
}

export function VendorForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  disabled,
}: Props) {
  const currenciesFn = useServerFn(listCurrencyCodes);
  const currencies = useSuspenseQuery(currencyCodesQueryOptions(currenciesFn));

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(initial),
  });

  useEffect(() => {
    form.reset(toFormValues(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);

  const submit = form.handleSubmit((v) => {
    const categories = (v.categories ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onSubmit({
      name: v.name,
      legal_name: v.legal_name || null,
      tax_id: v.tax_id || null,
      website: v.website || null,
      email: v.email || null,
      phone: v.phone || null,
      address_line: v.address_line || null,
      city: v.city || null,
      country: v.country || null,
      currency_code: v.currency_code || null,
      payment_terms: (v.payment_terms as any) || null,
      incoterms: (v.incoterms as any) || null,
      categories,
      notes: v.notes || null,
    });
  });

  const err = form.formState.errors;

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Identity
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Vendor name *</Label>
            <Input id="name" disabled={disabled} {...form.register("name")} />
            {err.name && (
              <p className="text-xs text-destructive">{err.name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal_name">Legal name</Label>
            <Input id="legal_name" disabled={disabled} {...form.register("legal_name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax_id">Tax ID / VAT</Label>
            <Input id="tax_id" disabled={disabled} {...form.register("tax_id")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" placeholder="https://" disabled={disabled} {...form.register("website")} />
            {err.website && (
              <p className="text-xs text-destructive">{err.website.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" disabled={disabled} {...form.register("email")} />
            {err.email && (
              <p className="text-xs text-destructive">{err.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" disabled={disabled} {...form.register("phone")} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Address
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="address_line">Address</Label>
            <Input id="address_line" disabled={disabled} {...form.register("address_line")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" disabled={disabled} {...form.register("city")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <Input id="country" disabled={disabled} {...form.register("country")} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Commercial
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select
              disabled={disabled}
              value={form.watch("currency_code") || ""}
              onValueChange={(v) => form.setValue("currency_code", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                {currencies.data.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Payment terms</Label>
            <Select
              disabled={disabled}
              value={form.watch("payment_terms") || "net_30"}
              onValueChange={(v) => form.setValue("payment_terms", v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace("_", " ").toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Incoterms</Label>
            <Select
              disabled={disabled}
              value={form.watch("incoterms") || "DAP"}
              onValueChange={(v) => form.setValue("incoterms", v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INCOTERMS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label htmlFor="categories">Categories (comma separated)</Label>
            <Input
              id="categories"
              placeholder="pv_modules, inverters, transformers"
              disabled={disabled}
              {...form.register("categories")}
            />
            <p className="text-xs text-muted-foreground">
              Short tags used for RFQ routing and reporting.
            </p>
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} disabled={disabled} {...form.register("notes")} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting || disabled}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
