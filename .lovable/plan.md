## P-070 — Material Price Alerts + Spare Parts

Two procurement utilities behind one migration, following P-068/P-069 conventions.

### 1. Migration `0031_procurement_extras.sql`
(0030 is taken by expediting; renumber to 0031.)
- Guarded `do` block for `material_category` enum.
- `material_price_alerts` and `spare_parts` tables per spec (schema, FKs, unique constraints, `sp_company_idx`).
- GRANTs to `authenticated`, `ALL` to `service_role`.
- RLS enable + policies (`mpa_select`/`mpa_write`, `sp_select`/`sp_write`) exactly as specified.
- Attach `set_updated_at()` BEFORE UPDATE triggers on both tables.

### 2. Pure rules — `src/lib/procurement-extras-rules.ts`
- `computeChangePct(prev, next)`, `shouldTrigger(changePct, threshold)`.
- `isLowStock(qtyOnHand, reorderPoint)`.
- `applyStockDelta(qty, delta)` with non-negative guard.
- Zod schemas: `priceObservationSchema`, `alertSubscriptionSchema`, `sparePartSchema`, `stockAdjustSchema` (reason required, min length 3).

### 3. Server functions
`src/lib/price-alerts.functions.ts`
- `listPriceAlerts`, `upsertPriceAlertSubscription` (category+region+threshold), `recordPriceObservation` (computes change_pct vs previous_price, sets triggered when |change_pct| ≥ threshold), `acknowledgePriceAlert` (clears triggered).
- Audits: `price_alert.subscribe`, `price_alert.observe`, `price_alert.acknowledge`.
- Role gate: procurement_admin | procurement_officer | company_admin.

`src/lib/spare-parts.functions.ts`
- `listSpareParts` (server search + category filter), `createSparePart`, `updateSparePart`, `deleteSparePart`, `adjustStock` (reason mandatory).
- Audits: `spare_part.create|update|delete|stock_adjust`.
- Role gate adds `om_admin`.

### 4. Query helpers
`src/lib/price-alerts-query.ts`, `src/lib/spare-parts-query.ts` with `queryOptions` factories.

### 5. UI
`src/routes/_authenticated/procurement.price-alerts.tsx`
- Header: "Subscribe" dialog (category, region, unit, currency, threshold %); "Record observation" dialog per row (new index price + optional source).
- KPI strip: total subs, triggered count, avg change %.
- Table: category, region, latest price (Intl currency), change % chip (green/destructive), threshold, triggered badge, actions (Record, Acknowledge).
- Triggered banner + sonner toast on new observation crossing threshold.
- Skeleton / empty / error / CSV export.

`src/routes/_authenticated/procurement.spare-parts.tsx`
- Header: "Add part" dialog (react-hook-form + zod), search input, category filter.
- KPI strip: total parts, "N parts below reorder point" (destructive tone when >0), total on-hand value.
- Table: part #, name, category, preferred vendor, qty on hand, reorder point, safety stock, lead time, location, low-stock destructive badge, actions (Edit, Adjust stock, Delete).
- `AdjustStockDialog` with delta (+/−) and mandatory reason.
- Skeleton / empty / error / CSV export.

Add both routes to `src/lib/nav-map.ts` under Procurement (`TrendingUp` for price alerts, `Package` for spare parts).

### 6. Tests
`tests/unit/procurement-extras-rules.test.ts` — change % math, threshold trigger boundaries, low-stock predicate, stock delta guard, zod validators (reason required).

### 7. Verification
- Typecheck; unit tests green.
- Manual acceptance list from prompt: migration idempotent, RLS cross-tenant blocked, module 0.120→0.131 triggers at 5%, acknowledge clears + audited, inverter-fan reorder=5/qty=3 shows destructive badge + KPI "1 part below reorder point", stock adjust requires reason and audits, both pages have skeleton/empty/error + CSV.

### Technical notes
- Migration file numbered `0031` to avoid clash with `0030_expediting.sql`.
- Reuse existing `writeAuditLog`, `requireSupabaseAuth`, `has_company_role`, `is_company_member`.
- Semantic tokens only; Intl for currency; date-fns for timestamps.
