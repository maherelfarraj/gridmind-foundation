// P-114 — Portal shell layout. Top bar only, no internal sidebar.
import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { UserMenu } from "@/components/user-menu";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portal")({
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
      { title: "Client Portal — GridMind EPC" },
      {
        name: "description",
        content: "Curated project portal for clients, investors, and lenders.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PortalLayout,
});

function PortalLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PortalTopBar />
      <MfaBanner />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function PortalTopBar() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-6">
        <Link
          to="/portal"
          className="font-display text-lg font-semibold tracking-tight text-foreground"
        >
          GridMind Portal
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function MfaBanner() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("portal-mfa-banner-dismissed") === "1";
  });

  useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa
      .listFactors()
      .then(({ data }) => {
        if (cancelled) return;
        const has = (data?.totp ?? []).some((f) => f.status === "verified");
        setEnrolled(has);
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
        <Button asChild size="sm" variant="secondary" className="ml-auto h-7 px-3 text-xs">
          <Link to="/portal">Enable 2FA</Link>
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            window.localStorage.setItem("portal-mfa-banner-dismissed", "1");
            setDismissed(true);
          }}
          className="rounded p-1 text-accent-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
