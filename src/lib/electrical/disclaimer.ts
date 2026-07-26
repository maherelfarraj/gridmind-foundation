// P-170 — Validation honesty.
//
// GridMind's electrical modules are small, verifiable calculators, not a
// commercial electrical-analysis suite. This single constant is the only
// wording used on study screens and in report footers; tests assert it.
// Pure module — no React, no Supabase, no route imports.

export const EA_VALIDATION_DISCLAIMER =
  "Engineering estimate — not formally validated against commercial analysis software. " +
  "Results must be checked and approved by a qualified engineer before use in design or " +
  "construction. Standards listed are configurable references, not compliance certifications.";
