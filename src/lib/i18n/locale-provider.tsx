// P-239 — locale provider: applies dir/lang to <html>, persists per user in
// profiles.locale, and falls back to localStorage before the profile loads.
import { useEffect, useMemo, useState, createContext, useContext, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LOCALE, dirFor, getI18n, isLocale, type Locale } from "./index";
import { cachedLocaleFor, clearCachedLocale, writeCachedLocale } from "./locale-storage";

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

  // Hydrate from the (user-scoped) cache, then from the signed-in profile.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      if (cancelled) return;

      const cached = cachedLocaleFor(uid);
      if (cached) applyLocale(cached);

      if (!uid) {
        if (!cached) applyLocale(DEFAULT_LOCALE);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("locale")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      const next = (profile as { locale?: string } | null)?.locale;
      // The profile always wins over the cache, and re-stamps it for this user.
      applyLocale(isLocale(next) ? next : DEFAULT_LOCALE);
      writeCachedLocale(uid, isLocale(next) ? next : DEFAULT_LOCALE);
    }

    void hydrate();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearCachedLocale();
        applyLocale(DEFAULT_LOCALE);
        return;
      }
      if (event === "SIGNED_IN") void hydrate();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
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
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      try {
        writeCachedLocale(uid, next);
      } catch {
        /* storage unavailable — in-memory only */
      }
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
