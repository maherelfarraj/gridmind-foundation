// P-264 — Header entry point into controlled-document search (⌘K / Ctrl+K).
import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/locale-provider";

export function DocumentSearchButton() {
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        void navigate({ to: "/documents/search" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <Button asChild variant="ghost" size="sm" title={t("engMod.docSearch.scopeLabel")}>
      <Link to="/documents/search" className="gap-2">
        <Search className="size-4" />
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {t("engMod.docSearch.scopeLabel")}
        </span>
      </Link>
    </Button>
  );
}
