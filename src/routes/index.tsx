import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GridMind EPC — The operating system for renewable EPC" },
      {
        name: "description",
        content:
          "One multi-tenant platform for solar PV, BESS, and substation delivery — from first lead to lifetime O&M.",
      },
      { property: "og:title", content: "GridMind EPC — The operating system for renewable EPC" },
      {
        property: "og:description",
        content:
          "One multi-tenant platform for solar PV, BESS, and substation delivery — from first lead to lifetime O&M.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const CHIPS = ["Phase-gated delivery", "Finance-grade controls", "Field-first, offline-ready"];

function LandingPage() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setSignedIn(true);
        navigate({ to: "/dashboard", replace: true });
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background px-6 py-24">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <span className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          GridMind EPC
        </span>

        <h1 className="mt-8 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          The operating system for renewable EPC
        </h1>

        <p className="mt-5 max-w-xl text-balance text-lg text-muted-foreground">
          From first lead to lifetime O&amp;M — one multi-tenant platform for solar, BESS, and
          substation delivery.
        </p>

        <Button asChild size="lg" className="mt-10">
          <Link to="/login">Sign in</Link>
        </Button>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {CHIPS.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground"
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
