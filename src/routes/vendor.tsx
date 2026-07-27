// P-222 — Vendor portal shell. Top bar only, no internal sidebar.
import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { UserMenu } from "@/components/user-menu";
import { listMyVendorMemberships } from "@/lib/vendor-portal.functions";

export const Route = createFileRoute("/vendor")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.pathname + location.searchStr },
      });
    }
    return { user: data.user };
  },
  head: () => ({
    meta: [
      { title: "Vendor Portal — GridMind EPC" },
      {
        name: "description",
        content: "Purchase orders, deliveries, invoices and documents for GridMind EPC vendors.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorPortalLayout,
});

function VendorPortalLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <VendorTopBar />
      <VendorMfaBanner />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function VendorTopBar() {
  const listFn = useServerFn(listMyVendorMemberships);
  const q = useQuery({
    queryKey: ["vendor-portal", "memberships"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });
  const brand = (q.data ?? []).find((m) => m.company_name || m.logo_url);

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-6">
        {brand?.logo_url ? (
          <img
            src={brand.logo_url}
            alt={`${brand.company_name ?? "Company"} logo`}
            className="h-7 w-auto"
          />
        ) : null}
        <Link
          to="/vendor"
          className="font-display text-lg font-semibold tracking-tight text-foreground"
        >
          {brand?.company_name ?? "GridMind"} Vendor Portal
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function VendorMfaBanner() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vendor-portal-mfa-banner-dismissed") === "1";
  });

  useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa
      .listFactors()
      .then(({ data }) => {
        if (cancelled) return;
        setEnrolled((data?.totp ?? []).some((f) => f.status === "verified"));
      })
      .catch(() => setEnrolled(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (enrolled !== false || dismissed) return null;

  return (
    <div className="border-b border-accent/40 bg-accent/20">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-2 text-sm">
        <ShieldCheck className="h-4 w-4 text-accent-foreground" aria-hidden />
        <span className="text-accent-foreground">
          For your security, enable two-factor authentication on your account.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            window.localStorage.setItem("vendor-portal-mfa-banner-dismissed", "1");
            setDismissed(true);
          }}
          className="ml-auto rounded p-1 text-accent-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
