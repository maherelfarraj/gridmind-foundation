// P-080 — TanStack Query options for debit notes.
import { queryOptions } from "@tanstack/react-query";
import { listDebitNotes } from "@/lib/debit-notes.functions";

export function debitNotesListQueryOptions(
  filters: { project_id?: string; status?: string } = {},
) {
  return queryOptions({
    queryKey: ["debit-notes", "list", filters.project_id ?? null, filters.status ?? null],
    queryFn: () => listDebitNotes({ data: filters }),
    staleTime: 15_000,
  });
}
