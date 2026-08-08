// GC-16d — Query options for calendar policy governance.
import { queryOptions } from "@tanstack/react-query";

import {
  getCalendarGovernance,
  getCalendarAccess,
} from "@/lib/calendar-governance.functions";
import type { CalendarGovernanceQuery } from "@/lib/calendar-governance.rules";

export function calendarGovernanceQueryOptions(query: Partial<CalendarGovernanceQuery> = {}) {
  return queryOptions({
    queryKey: [
      "calendar-governance",
      query.project_id ?? "company",
      query.contract_id ?? "none",
      query.calendar_id ?? "all",
    ],
    queryFn: () => getCalendarGovernance({ data: query }),
    staleTime: 10_000,
  });
}

export function calendarAccessQueryOptions() {
  return queryOptions({
    queryKey: ["calendar-governance", "access"],
    queryFn: () => getCalendarAccess(),
    staleTime: 60_000,
  });
}
