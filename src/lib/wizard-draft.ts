// P-033 — Project wizard draft store.
// SessionStorage-backed, survives reloads, cleared on submit/cancel.
import { useCallback, useEffect, useState } from "react";

import type { Database } from "@/integrations/supabase/types";
import type { ProjectBasics, ProjectSelection, ProjectTeam } from "@/lib/schemas/project-wizard";

export type ProjectArchetype = Database["public"]["Enums"]["project_archetype"];

export type ProjectDraft = {
  archetype?: ProjectArchetype;
  basics?: ProjectBasics;
  selection?: ProjectSelection;
  team?: Partial<ProjectTeam>;
};

const STORAGE_KEY = "gridmind:project-draft:v1";

function reviveDraft(input: unknown): ProjectDraft {
  if (!input || typeof input !== "object") return {};
  const d = { ...(input as ProjectDraft) };
  const basics = d.basics as
    | (Omit<ProjectBasics, "target_cod"> & { target_cod?: unknown })
    | undefined;
  if (basics && typeof basics.target_cod === "string") {
    const parsed = new Date(basics.target_cod);
    if (!isNaN(parsed.getTime())) {
      d.basics = { ...basics, target_cod: parsed } as ProjectBasics;
    }
  }
  return d;
}

export function readDraft(): ProjectDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return reviveDraft(JSON.parse(raw));
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
