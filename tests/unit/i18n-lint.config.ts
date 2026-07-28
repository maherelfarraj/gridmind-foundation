// P-244 — repo-wide hardcoded user-facing string lint.
//
// Rule: no raw user-facing text may appear as JSX children in src/routes or
// src/components. Everything must go through t().
//
// Exemptions are explicit and enumerated here — there are no silent ignores.
// The `BASELINE` list records files from modules that predate Batch 31's
// Arabic pass; they are allowed to keep their existing raw strings but the
// count may only shrink (the lint fails if a baseline file gains strings, and
// fails if a file is listed but is already clean).

export interface LintExemption {
  pattern: RegExp;
  reason: string;
}

/** Strings that look like JSX text but are not user-facing prose. */
export const STRING_EXEMPTIONS: LintExemption[] = [
  { pattern: /^[A-Za-z]+\s*[?&|]{1,2}\s*\(?$/, reason: "JSX conditional/expression fragment" },
  {
    pattern: /^(Promise|Record|Array|Partial|Awaited|ReturnType)$/,
    reason: "TypeScript generic argument",
  },
  { pattern: /^\w+\(\)[\w\s.]*$/, reason: "code expression, not prose" },
  { pattern: /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, reason: "dotted identifier / property path" },
  {
    pattern: /^(GridMind EPC|GridMind|NEPCO|H₂)$/,
    reason: "brand or proper noun, intentionally untranslated",
  },
  {
    pattern: /^[A-Z]{2,6}(-[A-Z0-9]+)*$/,
    reason: "Latin equipment tag / acronym (INV-01-01, SCADA, CSV)",
  },
  { pattern: /^[\d\s.,%/+-]+$/, reason: "numeric literal" },
];

/** Files exempt in full, with the reason. */
export const FILE_EXEMPTIONS: Array<{ file: string; reason: string }> = [
  { file: "src/components/app-sidebar.tsx", reason: "brand wordmark only" },
];

export function isExemptString(value: string): boolean {
  return STRING_EXEMPTIONS.some((e) => e.pattern.test(value));
}

/** Matches text nodes between JSX tags. */
export const JSX_TEXT_RE = />\s*([A-Za-z][A-Za-z0-9 '’,.!?%()/&:-]{2,})\s*</g;

export function extractRawStrings(source: string): string[] {
  return [...source.matchAll(JSX_TEXT_RE)]
    .map((m) => m[1].trim())
    .filter((s) => !isExemptString(s));
}
