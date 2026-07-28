// P-252/P-253/P-254 — Query options for the portfolio dashboard.
import { queryOptions } from "@tanstack/react-query";

import {
  getPortfolioCashCurveProjects,
  getPortfolioCashMonth,
  getPortfolioHseExposure,
  getPortfolioKpis,
  getPortfolioProjectCards,
} from "@/lib/portfolio.functions";

export function portfolioKpisQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "kpis"],
    queryFn: () => getPortfolioKpis(),
    staleTime: 30_000,
  });
}

export function portfolioExposureQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "hse-exposure"],
    queryFn: () => getPortfolioHseExposure(),
    staleTime: 30_000,
  });
}

export function portfolioProjectCardsQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "project-cards"],
    queryFn: () => getPortfolioProjectCards(),
    staleTime: 30_000,
  });
}

export function portfolioCashCurveQueryOptions(range: { back: number; forward: number }) {
  return queryOptions({
    queryKey: ["portfolio", "cash-curve", range.back, range.forward],
    queryFn: () => getPortfolioCashCurveProjects({ data: range }),
    staleTime: 30_000,
  });
}

export function portfolioCashMonthQueryOptions(month: string | null) {
  return queryOptions({
    queryKey: ["portfolio", "cash-month", month],
    queryFn: () => getPortfolioCashMonth({ data: { month: month as string } }),
    enabled: Boolean(month),
    staleTime: 30_000,
  });
}
