// P-033 — Project wizard draft store.
// SessionStorage-backed, survives reloads, cleared on submit/cancel.
import { useCallback, useEffect, useState } from "react";

import type { Database } from "@/integrations/supabase/types";

export type ProjectArchetype =
  Database["public"]["Enums"]["project_archetype"];

export type ProjectDraft = {
  archetype?: ProjectArchetype;
  // Steps 2–4 append fields here.
};

const STORAGE_KEY = "gridmind:project-draft:v1";

export function readDraft(): ProjectDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as ProjectDraft;
    return {};
  } catch {
    return {};
  }
}

export function writeDraft(patch: Partial<ProjectDraft>): ProjectDraft {
  const next = { ...readDraft(), ...patch };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private-mode failures
  }
  return next;
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useProjectDraft() {
  const [draft, setDraftState] = useState<ProjectDraft>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDraftState(readDraft());
    setHydrated(true);
  }, []);

  const setDraft = useCallback((patch: Partial<ProjectDraft>) => {
    const next = writeDraft(patch);
    setDraftState(next);
  }, []);

  const clear = useCallback(() => {
    clearDraft();
    setDraftState({});
  }, []);

  return { draft, setDraft, clear, hydrated };
}
