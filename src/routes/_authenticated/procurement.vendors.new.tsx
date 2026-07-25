// P-061 — New vendor onboarding page.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VendorForm } from "@/components/procurement/vendor-form";
import { useCreateVendor } from "@/lib/vendors-query";

export const Route = createFileRoute("/_authenticated/procurement/vendors/new")({
  head: () => ({
    meta: [
      { title: "Onboard vendor — GridMind EPC" },
      {
        name: "description",
        content:
          "Onboard a new supplier: identity, commercial terms, categories, and certifications.",
      },
      { property: "og:title", content: "Onboard vendor — GridMind EPC" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: NewVendor,
});

function NewVendor() {
  const navigate = useNavigate();
  const create = useCreateVendor();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/vendors" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to vendors
        </Button>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Onboard vendor</h1>
        <p className="text-sm text-muted-foreground">
          Capture identity and commercial terms. You can attach certifications after saving.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <VendorForm
          submitting={create.isPending}
          submitLabel="Create vendor"
          onCancel={() => navigate({ to: "/procurement/vendors" })}
          onSubmit={(input) =>
            create.mutate(input, {
              onSuccess: ({ id }) =>
                navigate({
                  to: "/procurement/vendors/$vendorId",
                  params: { vendorId: id },
                }),
            })
          }
        />
      </div>
    </div>
  );
}
