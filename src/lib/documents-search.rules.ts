// P-264 — Pure rules for controlled-document full-text search.
// Scope honesty: this searches the *document register* (controlled documents),
// never "all files in storage".
//
// Arabic note: Postgres has no Arabic stemmer, so the tsvector uses the
// 'simple' configuration (exact token match, no stemming). We normalise the
// query client-side — strip tashkeel/tatweel, unify alef/ya/ta-marbuta forms —
// so common spelling variants still hit. Root-based Arabic matching is a real
// limitation, documented rather than faked.

export const DOC_SEARCH_MIN_LENGTH = 2;
export const RECENT_SEARCHES_KEY = "gridmind-doc-recent-searches";
export const RECENT_SEARCHES_MAX = 8;

// Built from a string so the linter does not read the class as combined chars.
const ARABIC_DIACRITICS = new RegExp("[\\u064B-\\u0652\\u0640\\u0670]", "g");

export function normalizeQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // alef variants → ا
    .replace(/\u0649/g, "\u064A") // alef maqsura → ي
    .replace(/\u0629/g, "\u0647") // ta marbuta → ه
    .replace(/\s+/g, " ")
    .trim();
}

/** Empty-query guard: below the minimum we never hit the database. */
export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= DOC_SEARCH_MIN_LENGTH;
}

export interface DocSearchFilters {
  projectId?: string | null;
  docType?: string | null;
  status?: string | null;
  discipline?: string | null;
  retentionClass?: string | null;
  from?: string | null;
  to?: string | null;
}

/** "all"/""/undefined all mean "no filter" — collapse them to null. */
export function cleanFilters(filters: DocSearchFilters | undefined): Required<DocSearchFilters> {
  const pick = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s === "" || s === "all" ? null : s;
  };
  return {
    projectId: pick(filters?.projectId),
    docType: pick(filters?.docType),
    status: pick(filters?.status),
    discipline: pick(filters?.discipline),
    retentionClass: pick(filters?.retentionClass),
    from: pick(filters?.from),
    to: pick(filters?.to),
  };
}

export interface DocSearchHit {
  id: string;
  doc_number: string;
  title: string;
  doc_type: string | null;
  discipline: string | null;
  current_revision: string | null;
  status: string | null;
  retention_class: string | null;
  project_id: string | null;
  project_name: string | null;
  file_name: string | null;
  has_content: boolean;
  updated_at: string;
  rank: number;
  snippet: string | null;
}

export interface DocSearchGroup {
  docType: string;
  hits: DocSearchHit[];
}

/** Results grouped by doc type, groups ordered by their best-ranked hit. */
export function groupByType(hits: DocSearchHit[]): DocSearchGroup[] {
  const map = new Map<string, DocSearchHit[]>();
  for (const hit of hits) {
    const key = hit.doc_type ?? "other";
    const bucket = map.get(key);
    if (bucket) bucket.push(hit);
    else map.set(key, [hit]);
  }
  return [...map.entries()]
    .map(([docType, group]) => ({
      docType,
      hits: [...group].sort((a, b) => b.rank - a.rank),
    }))
    .sort((a, b) => b.hits[0].rank - a.hits[0].rank);
}

/** Recent searches (per user, localStorage) — newest first, de-duplicated. */
export function pushRecentSearch(list: string[], query: string): string[] {
  const normalized = normalizeQuery(query);
  if (normalized.length < DOC_SEARCH_MIN_LENGTH) return list;
  return [normalized, ...list.filter((q) => q !== normalized)].slice(0, RECENT_SEARCHES_MAX);
}

export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, RECENT_SEARCHES_MAX)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // storage disabled — recent searches are a convenience, never a failure
  }
}

/** ts_headline emits <mark> tags; split into safe segments for React rendering. */
export function snippetSegments(snippet: string | null): Array<{ text: string; mark: boolean }> {
  if (!snippet) return [];
  return snippet
    .split(/(<mark>[\s\S]*?<\/mark>)/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("<mark>")
        ? { text: part.slice(6, -7), mark: true }
        : { text: part, mark: false },
    );
}
