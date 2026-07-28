// P-239 — locale-aware formatting. Western digits for now (latn), dates via Intl.
import type { Locale } from "./index";

const NUM_LOCALE: Record<Locale, string> = {
  en: "en-US",
  ar: "ar-JO-u-nu-latn",
};

export function intlLocale(locale: Locale): string {
  return NUM_LOCALE[locale] ?? NUM_LOCALE.en;
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatCurrency(
  value: number,
  locale: Locale,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(d);
}
