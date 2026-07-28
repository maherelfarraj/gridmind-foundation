// P-244 — locale persistence isolation.
//
// The profile row (profiles.locale) is the source of truth. localStorage only
// bridges the gap between first paint and the profile fetch. On a shared
// machine that bridge must not leak one user's locale into another user's
// session, so the cached value is stamped with the user id it belongs to and
// is cleared on sign-out.
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, isLocale, type Locale } from "./index";

interface CachedLocale {
  uid: string | null;
  locale: Locale;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCachedLocale(): CachedLocale | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(LOCALE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { uid?: unknown; locale?: unknown };
    if (!isLocale(parsed.locale)) return null;
    return { uid: typeof parsed.uid === "string" ? parsed.uid : null, locale: parsed.locale };
  } catch {
    // Legacy unscoped value written before P-244 — untrusted, drop it.
    store.removeItem(LOCALE_STORAGE_KEY);
    return null;
  }
}

/** Locale to use before the profile resolves; only honours the cache when it belongs to this user. */
export function cachedLocaleFor(uid: string | null): Locale | null {
  const cached = readCachedLocale();
  if (!cached) return null;
  if (cached.uid !== uid) return null;
  return cached.locale;
}

export function writeCachedLocale(uid: string | null, locale: Locale) {
  storage()?.setItem(LOCALE_STORAGE_KEY, JSON.stringify({ uid, locale }));
}

/** Sign-out: forget the cached locale so the next account starts from its own profile. */
export function clearCachedLocale() {
  storage()?.removeItem(LOCALE_STORAGE_KEY);
}

export { DEFAULT_LOCALE };
