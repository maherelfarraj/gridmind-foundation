// P-239 — i18n foundation. One i18next instance for the app, plus a factory the
// tests use to build isolated instances. Arabic plural handling comes from
// i18next's Intl.PluralRules backend (JSON v4 suffixes: zero/one/two/few/many/other).
import i18next, { type i18n as I18nType } from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./ar.json";
import en from "./en.json";
import financeAr from "./finance.ar.json";
import financeEn from "./finance.en.json";
import procurementAr from "./procurement.ar.json";
import procurementEn from "./procurement.en.json";
import portalAr from "./portal.ar.json";
import portalEn from "./portal.en.json";
import fieldAr from "./field.ar.json";
import fieldEn from "./field.en.json";
import omAr from "./om.ar.json";
import omEn from "./om.en.json";
import engAr from "./eng.ar.json";
import engEn from "./eng.en.json";
import adminOpsAr from "./adminops.ar.json";
import portfolioAr from "./portfolio.ar.json";
import portfolioEn from "./portfolio.en.json";
import adminOpsEn from "./adminops.en.json";

export type Locale = "en" | "ar";

export const LOCALES: Locale[] = ["en", "ar"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "gridmind-locale";

// P-241/P-243 — module catalogs live in their own files so parallel module
// passes never collide; they merge under the `<name>Mod` roots.
export const resources = {
  en: {
    translation: {
      ...en,
      financeMod: financeEn,
      procurementMod: procurementEn,
      fieldMod: fieldEn,
      portalMod: portalEn,
      omMod: omEn,
      engMod: engEn,
      adminMod: adminOpsEn,
      portfolioMod: portfolioEn,
    },
  },
  ar: {
    translation: {
      ...ar,
      financeMod: financeAr,
      procurementMod: procurementAr,
      fieldMod: fieldAr,
      portalMod: portalAr,
      omMod: omAr,
      engMod: engAr,
      adminMod: adminOpsAr,
      portfolioMod: portfolioAr,
    },
  },
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
