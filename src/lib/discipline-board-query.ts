// P-085 — Query options for the discipline board.
import { queryOptions } from "@tanstack/react-query";

import {
  getDisciplineBoard,
  listDisciplineBoardProjects,
} from "@/lib/discipline-board.functions";

export const disciplineBoardProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["discipline-board", "projects"],
    queryFn: () => listDisciplineBoardProjects(),
    staleTime: 60_000,
  });

export const disciplineBoardQueryOptions = (
  projectId: string,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: ["discipline-board", projectId, from, to],
    queryFn: () => getDisciplineBoard({ data: { projectId, from, to } }),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  });
