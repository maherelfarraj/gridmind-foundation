## P-109 — Service Tickets + SLA Timers + Breach Log

### Migration (new timestamped file, warranty/sla domain)
Add enums (`ticket_category`, `ticket_status` via guarded `do`-blocks), tables `service_tickets` and `sla_records` exactly per spec, with GRANTs to `authenticated`, RLS enabled, member-SELECT + om_admin/company_admin writes, `set_updated_at` triggers, and the two indexes. `ticket_number` = `ST-YYYY-NNNN` per company.

### Server layer
- `src/lib/service-tickets.rules.ts` — SLA policy map constant:
  - emergency 1h/8h, high 4h/24h, medium 8h/72h, low 24h/168h
  - Credit constants: response 5%, resolution 10%, cap 20% of monthly O&M fee
  - Pure helpers: `computeDueDates(priority, createdAt)`, `evaluateBreach(sla, now)`, `computeCredit(response_breached, resolution_breached, monthlyFee)`
  - Zod schemas for create/update, plus countdown-status classifier (`on_track` | `warning <25%` | `breached`)
- `src/lib/service-tickets.server.ts` — `generateTicketNumber(companyId)` with retry (mirrors `generateClaimNumber`)
- `src/lib/service-tickets.functions.ts` (`createServerFn` + `requireSupabaseAuth`):
  - `listTickets({ projectId?, status?, priority?, search? })` with joined assignee name and its `sla_records` row
  - `getTicket({ id })`
  - `createTicket(input)` → inserts ticket + matching `sla_records` in one flow, audits `ticket.create`
  - `updateTicket(input)` → on status transition set `responded_at` (first non-open), `resolved_at` (resolved/closed); re-evaluate breach flags + `breach_minutes` server-side; audits `ticket.update` / `ticket.resolve`
  - `applySlaCredit({ ticketId, monthlyFee, currencyCode })` → recomputes credit %, stores `credit_amount`, audits `sla.credit_apply`
  - `listBreaches({ projectId? })` for the Breach log tab

### UI — `/om/service-tickets` (route: `om.service-tickets.tsx`)
Tabs component with two tabs:
1. **Tickets** — table (number, title, priority badge, status, assignee, live SLA countdown chip). Chip color from `sla-status` helper: on-track (success token), <25% (warning), breached (destructive). Countdown re-renders on a 30s tick. Row click → drawer.
2. **Breach log** — table joining `sla_records` where any breach flag is true; columns: ticket, breach type, breach_minutes, credit_pct, credit_amount. CSV export button (reuse pattern from warranties).

Components:
- `service-ticket-dialog.tsx` — react-hook-form + zod for create/edit: project, title, description, category, priority, assignee, optional `related_work_order_id` (async combobox of open WOs on same project).
- `service-ticket-drawer.tsx` — details + status transitions (buttons that call `updateTicket`) + SLA panel (due timestamps, responded_at, resolved_at, breach flags) + "Apply SLA credit" mini-form (monthly fee input + currency) invoking `applySlaCredit`.
- `sla-countdown-chip.tsx` — pure display component driven by rules helper.

All lists have skeleton/empty/error states; every mutation audited; strictly semantic tokens.

### Navigation
Add "Service Tickets" (Ticket icon) under O&M in `src/lib/nav-map.ts`.

### Tests — `tests/unit/service-tickets.test.ts`
- `computeDueDates` returns correct offsets per priority
- `evaluateBreach` flips flags and sets `breach_minutes` when `now > due`
- `computeCredit`: response only → 5%; both → 15%; capped at 20% of monthly fee; `credit_amount` math
- Countdown classifier boundaries (100%, 25%, 0% remaining)
- Zod create schema requires title, project, priority

### Verification checklist
- Emergency ticket → sla_records with 1h/8h; medium → 8h/72h
- Force breach via update with backdated `created_at` in test → chip destructive, `breach_minutes` set
- Credit computation stored (5/10/15/20% cap) against a supplied monthly fee
- Breach log CSV export works
- Link a ticket to the INV-01-01 work order
- RLS: cross-company user cannot see tickets/SLA rows
