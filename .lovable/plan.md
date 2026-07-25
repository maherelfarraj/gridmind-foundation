# P-078 — Contracts & AI Clause Extractor

## 1. Migration `supabase/migrations/0035_contracts.sql`

Guarded enums + tables + RLS + grants + indexes exactly as in the prompt. Both enums wrapped in `do $$ begin ... exception when duplicate_object then null; end $$;`. `updated_at` triggers via existing `set_updated_at()`. Explicit note: `legal_admin` already exists in `app_role`. No DELETE grant (retention enforced by absence of delete permission + `retention_until`).

## 2. Server rules — `src/lib/contracts.rules.ts`

- `sovTotal(lines)` → decimal-safe sum.
- `assertSovMatchesValue(value, lines, tolerance=0.01)` → throws `SovMismatchError` if `|Σ − value| > tol`.
- `computeRetentionUntil(signedAt)` → `signedAt + 7y` (date-fns).
- Zod schemas: `SovLineSchema`, `ContractUpsertSchema`, `ObligationSchema`, `ExtractedObligationSchema` (`title`, `description?`, `clause_ref?`, `due_date?` ISO).
- `isObligationOverdue(due_date, status)`.

Unit tests: `tests/unit/contracts-rules.test.ts` (SOV sum tolerance, retention math, overdue flag, zod parsing).

## 3. Server functions — `src/lib/contracts.functions.ts`

All `createServerFn` + `requireSupabaseAuth`, RLS-scoped supabase client:
- `listContracts({ project_id?, status?, q?, type? })`
- `getContract({ id })` — returns contract + obligations + SOV.
- `upsertContract(payload)` — zod-validated; on insert auto-generates `contract_number` (`CT-YYYY-####`).
- `updateScheduleOfValues({ id, lines })` — validates Σ SOV = value, else throws (surfaced as inline error).
- `markContractSigned({ id, signed_at, file_path })` — sets `status='signed'`, `signed_at`, `retention_until = signed_at + 7y`; writes `contract.sign` audit.
- `uploadSignedCopy` helper path convention: `{company_id}/contracts/{contract_id}/{filename}` in `documents` bucket (company UUID first for storage RLS).
- `addObligation`, `updateObligation`, `bulkInsertObligations({ contract_id, items, extracted_by_ai })`.
- `extractContractClauses({ contract_id, pdf_text })`:
  - Role check: `finance_admin | legal_admin | company_admin`.
  - Rate-limit via existing `consume_rate_limit` (`ai:extract:{company}`, 10/hour).
  - Calls Lovable AI Gateway `POST https://ai.gateway.lovable.dev/v1/chat/completions` with `Authorization: Bearer ${process.env.LOVABLE_API_KEY}`, model `google/gemini-2.5-flash`, system prompt for EPC/PPA clause taxonomy (payments, LDs, warranties, notice periods, insurance, deliverables), `response_format: { type: "json_object" }`.
  - Truncates `pdf_text` to ~120k chars defensively.
  - Parses response with `z.array(ExtractedObligationSchema)`; returns array **without** inserting.
  - Handles 429 → typed "rate_limited", 402 → "credits_exhausted", other → generic "gateway_error".
  - Audits `contract.ai_extract` with `{contract_id, extracted: n, accepted: 0}` on extract; `bulkInsertObligations` (when caller is AI flow) writes second audit with `accepted: n`.

Query helpers: `src/lib/contracts.query.ts` (queryOptions).

## 4. PDF text extraction

Client-side extraction using `pdfjs-dist` (already in tree via jspdf ecosystem? — will install if missing: `pdfjs-dist` legacy build, dynamic-imported in the AI dialog so it never enters SSR).

## 5. Routes & UI (semantic tokens only, existing shadcn primitives)

- `src/routes/_authenticated/finance/contracts.tsx` — server-filtered table (number, title, counterparty, type, value+currency, status Badge, expiry), search + type/status filters, CSV export via existing `csv.ts`, skeleton/empty/error states.
- `src/routes/_authenticated/finance/contracts.$contractId.tsx` — Tabs:
  - **Overview**: react-hook-form + zod edit form; "Mark signed" button (opens upload dialog → uploads to `documents` bucket → calls `markContractSigned`). Read-only after `signed`+ status except allowed metadata.
  - **Schedule of Values**: editable grid (line_no, description, scheduled_amount) with live running total vs contract value; save disabled + inline error if mismatch.
  - **Obligations**: table with add/edit dialog; overdue rows use `bg-destructive/10 text-destructive` (semantic tokens); status workflow open→in_progress→fulfilled/breached; "Extract clauses with AI" button (role-gated) → `ExtractClausesDialog`:
    - Requires uploaded contract file; extracts text via `pdfjs-dist`.
    - Shows spinner during gateway call; error banner + Retry on failure.
    - Review dialog with per-row checkboxes (all pre-checked), editable due date, then "Import selected" → `bulkInsertObligations` with `extracted_by_ai: true`.
- Nav: add "Contracts" under Finance in `src/lib/nav-map.ts`.

## 6. Verification checklist

- Migration runs twice cleanly (guarded enums + `if not exists`).
- RLS: non-finance/legal user gets 42501 on write (verified via read_query with role probe).
- Create EPC contract, value $20M; SOV lines summing to $20M accepted; mismatched rejected with clear error.
- Sign → `retention_until = signed_at + 7y`, file at `{company}/contracts/{id}/…`.
- AI extract on a real PDF returns obligations w/ clause refs; accept 3 → inserted with `extracted_by_ai=true`.
- Audit rows: `contract.sign`, `contract.ai_extract` present with metadata.
- `LOVABLE_API_KEY` used only inside server fn handler; never in client bundle (grep verify).

## Technical notes

- Enums may already exist across environments — guarded `do $$` blocks handle re-runs.
- Bucket `documents` is private; downloads via short-lived signed URLs.
- AI call is server-only (`createServerFn`) — key stays in Worker env.
- No auto-insert of AI results — review-before-insert is enforced in UI + server (extract and bulkInsert are separate RPCs).
- After migration approval, regenerated `Database` types will be picked up automatically.
