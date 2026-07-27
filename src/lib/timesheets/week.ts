// P-228 — Monday-anchored week helpers. PURE module: no React, no Supabase.
import { TIMESHEET_POLICY } from "@/lib/timesheets/policy";

const DAY_MS = 24 * 60 * 60 * 1000;

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO day-of-week: Monday = 1 … Sunday = 7. */
export function isoDayOfWeek(dateIso: string): number {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isMonday(dateIso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateIso) && isoDayOfWeek(dateIso) === 1;
}

/** Monday of the ISO week containing `dateIso` (or today). */
export function weekStartOf(dateIso?: string): string {
  const base = dateIso ? new Date(`${dateIso}T00:00:00Z`) : new Date();
  const iso = toIsoDate(base);
  const offset = isoDayOfWeek(iso) - 1;
  return toIsoDate(new Date(new Date(`${iso}T00:00:00Z`).getTime() - offset * DAY_MS));
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return toIsoDate(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + weeks * 7 * DAY_MS));
}

/** The seven ISO dates Mon..Sun of a week. */
export function weekDays(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, i) => toIsoDate(new Date(base + i * DAY_MS)));
}

export function isWeekend(dateIso: string, weekendDays = TIMESHEET_POLICY.weekendDays): boolean {
  return weekendDays.includes(isoDayOfWeek(dateIso));
}
