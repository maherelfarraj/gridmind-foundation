// P-239 — i18n foundation. One i18next instance for the app, plus a factory the
// tests use to build isolated instances. Arabic plural handling comes from
// i18next's Intl.PluralRules backend (JSON v4 suffixes: zero/one/two/few/many/other).
import i18next, { type i18n as I18nType } from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./ar.json";
import en from "./en.json";

export type Locale = "en" | "ar";

export const LOCALES: Locale[] = ["en", "ar"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "gridmind-locale";

export const resources = {
  en: { translation: en },
  ar: { translation: ar },
} as const;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Isolated instance — used by tests and by SSR-safe callers. */
export function createI18n(locale: Locale = DEFAULT_LOCALE): I18nType {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: LOCALES,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

let initialized = false;

export function getI18n(locale: Locale = DEFAULT_LOCALE): I18nType {
  if (!initialized) {
    initialized = true;
    void i18next.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: LOCALES,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }
  return i18next;
}

export default i18next;
