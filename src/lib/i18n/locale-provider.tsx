// P-239 — locale provider: applies dir/lang to <html>, persists per user in
// profiles.locale, and falls back to localStorage before the profile loads.
import { useEffect, useMemo, useState, createContext, useContext, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  dirFor,
  getI18n,
  isLocale,
  type Locale,
} from "./index";

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  dir: "ltr",
  setLocale: () => {},
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Convenience: translation fn + current locale in one call. */
export function useI18n() {
  const { t } = useTranslation();
  const { locale, dir, setLocale } = useLocale();
  return { t, locale, dir, setLocale };
}

export function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("lang", locale);
  root.setAttribute("dir", dirFor(locale));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const i18n = useMemo(() => getI18n(DEFAULT_LOCALE), []);

  // Hydrate from localStorage, then from the signed-in user's profile.
  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) applyLocale(stored);

    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("locale")
        .eq("id", uid)
        .maybeSingle();
      const next = (profile as { locale?: string } | null)?.locale;
      if (!cancelled && isLocale(next)) applyLocale(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyLocale(next: Locale) {
    setLocaleState(next);
    void i18n.changeLanguage(next);
    applyDocumentLocale(next);
  }

  function setLocale(next: Locale) {
    applyLocale(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — in-memory only */
    }
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      await supabase.from("profiles").update({ locale: next }).eq("id", uid);
    })();
  }

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: dirFor(locale), setLocale }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </I18nextProvider>
  );
}
