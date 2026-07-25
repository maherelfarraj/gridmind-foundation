## P-080 — Invoices + debit notes + milestone billing

### 1. Migration `supabase/migrations/0037_debit_notes.sql`
- Guarded `do $$` enum: `debit_note_status ('draft','issued','settled','cancelled')`.
- Table `public.debit_notes` per spec (tenancy cols, FKs to contracts/invoices, `note_number` unique per company, `amount >= 0`, currency FK, timestamps).
- `set_updated_at` trigger.
- RLS enabled; policies: `dn_select` (`is_company_member`), `dn_write` (finance/company admin).
- `GRANT SELECT, INSERT, UPDATE ON public.debit_notes TO authenticated;` — no DELETE (7-yr retention → cancel instead).
- Composite index `(company_id, project_id, status)`.

### 2. Server logic
- `src/lib/invoices.rules.ts` — Zod: `MilestoneBillSchema` (contract_id, sov_line_no, pct_to_bill 0<pct≤100), `MarkInvoicePaidSchema`. Helper `computeMilestoneBill(sov, prevBilledForLine, pct)` returning `{ amount, cappedPct, remaining }` (cents-int, caps at remaining unbilled).
- Extend `src/lib/invoices.functions.ts` with `listInvoices` (filters: project, direction, status, q), `getInvoiceDetail` (invoice + contract + linked pay app + linked matches summary + debit note totals), `markInvoicePaid` (payable: query `three_way_matches.payment_release_blocked` → block on any true; receivable: skip), `billMilestone` (loads contract SOV, sums prior invoices w/ same `milestone_label` prefix `SOV#n` for that contract, enforces remaining, creates receivable draft invoice `INV-####` with `milestone_label = "SOV #<n> — <desc> @<pct>%"`). All emit `writeAuditLog` (`invoice.pay`, `invoice.milestone_bill`).
- `src/lib/invoices.query.ts` — queryOptions for list/detail/access (roles).
- `src/lib/invoices.csv.ts` — CSV export.
- `src/lib/debit-notes.rules.ts` — Zod schemas (create/update/issue/settle/cancel), `nextDebitNoteNumber(existing) → DN-####` (mirrors `nextInvoiceNumber`), `REASONS` const.
- `src/lib/debit-notes.functions.ts` — RPCs: `listDebitNotes`, `upsertDebitNote` (draft only), `issueDebitNote` (draft→issued, sets `issued_at`+DN number, requires invoice_id-or-contract_id), `settleDebitNote` (issued→settled + settled_at), `cancelDebitNote` (draft|issued→cancelled). Audits `debit_note.issue|settle|cancel`. Helper `sumOpenDebitAgainstInvoice(invoiceId)` used by invoice detail.
- `src/lib/debit-notes.query.ts` — queryOptions.

### 3. Routes / UI (semantic tokens only)
- `src/routes/_authenticated/finance.invoices.tsx` — server-filtered table (columns: number, direction badge, project, contract, amount + tax, status badge, due date), search + direction/status filters, CSV export, skeleton, empty "No invoices yet", errorComponent with retry via `router.invalidate()`. Row click opens detail drawer.
- `src/components/finance/invoice-detail-drawer.tsx` — fields, linked pay app link, linked contract link, **open balance** (`amount + tax − sum(issued/settled debit_notes)` for payable), payment actions: "Mark paid" button. On payable, if server returns `payment_release_blocked`, show destructive banner "Payment release blocked by 3-way match variance" with link to matches screen. Receivable skips guard.
- `src/routes/_authenticated/finance.contracts.$contractId.tsx` — add "Bill milestone" button opening `MilestoneBillDialog` (SOV list w/ remaining %, %-to-bill input, live amount preview, confirm creates draft invoice + toast + navigates to invoice).
- `src/routes/_authenticated/finance.debit-notes.tsx` — table (number, status, reason, amount, linked invoice/contract, issued_at), skeleton/empty/error, drawer w/ create/edit form (reason select from `REASONS`, amount+currency, linked contract/invoice pickers, notes) and workflow buttons (issue/settle/cancel gated by role+status).
- Nav update in `src/lib/nav-map.ts`: add Invoices and Debit notes under Finance.

### 4. Tests `tests/unit/invoices-debit-notes-rules.test.ts`
- `computeMilestoneBill`: normal, cap-at-remaining, reject > remaining, 0%, 100%, cents-safe (0.1+0.2 style).
- `nextDebitNoteNumber`: empty→DN-0001, gaps ignored, non-DN strings ignored, advances past max.
- Milestone billing prev-billed aggregation with mixed `milestone_label` values.

### 5. Verification checklist (from spec)
- [ ] Payable invoice linked to blocked match → "Payment release blocked" banner; resolve match → allowed.
- [ ] Receivable invoice pay flow unaffected.
- [ ] Milestone billing 30% → correct amount; 90% more → capped at remaining.
- [ ] DN-0001 (defect_rectification) against payable invoice → open balance reduced; settle → timestamps + audits.
- [ ] `invoice.pay`, `invoice.milestone_bill`, `debit_note.*` in audit log.
- [ ] Skeleton/empty/CSV on both pages.

### Technical notes
- `three_way_matches` has `payment_release_blocked` column (verified) — direct query, no schema change.
- Existing `invoices` table already has `tax_amount`, `retention_pct`, `paid_at` — no schema change.
- Reuse patterns from `pay-app.functions.ts` (role guard, `httpError`, `currentCompanyId`, `audit`).
- Milestone `prev billed` derived from `invoices` where `contract_id=? AND direction='receivable' AND status<>'cancelled' AND milestone_label LIKE 'SOV #<n>%'` — per-line unbilled remaining = `scheduled - Σamount`.
