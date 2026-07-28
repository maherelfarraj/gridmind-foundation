import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { resolveLandingRoute } from "@/lib/portal-landing";
import { useI18n } from "@/lib/i18n/locale-provider";

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

const CHIP_KEYS = ["landing.chip1", "landing.chip2", "landing.chip3"] as const;

function LandingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  const [landing, setLanding] = useState("/dashboard");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return;
      const target = await resolveLandingRoute("/dashboard");
      if (!active) return;
      setSignedIn(true);
      setLanding(target);
      navigate({ to: target, replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background px-6 py-24">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <span className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          {t("landing.eyebrow")}
        </span>

        <h1 className="mt-8 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          {t("landing.headline")}
        </h1>

        <p className="mt-5 max-w-xl text-balance text-lg text-muted-foreground">
          {t("landing.subhead")}
        </p>

        <Button asChild size="lg" className="mt-10">
          <Link to={signedIn ? landing : "/login"}>
            {signedIn ? t("landing.openWorkspace") : t("common.signIn")}
          </Link>
        </Button>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {CHIP_KEYS.map((key) => (
            <li
              key={key}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground"
            >
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
