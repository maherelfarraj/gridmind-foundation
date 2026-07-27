## Day 2 — Real procurement cycle on GSI-EAM-001

Execute the golden path through the live app (browser automation against the running preview, signed in with the managed session), no SQL inserts. Reads/queries are used only for verification evidence.

### Route map (all screens already exist)
```text
/procurement/vendors/new        register vendor
/procurement/scorecards         scorecard profile
/procurement/rfqs/new           RFQ on GSI-EAM-001
/procurement/rfqs/$rfqId        bids, TCO leveling, award
/procurement/pos/$poId          PO detail + approval trail
/approvals                      CFO gate decision (finance_admin)
/vendor/$vendorId/pos           vendor ack (P-223)
/vendor/$vendorId/deliveries    proposed delivery window (P-224)
/procurement/expediting         expediting row, eta_confirmed = false
```

### Steps
1. **Vendor** — register a PV module supplier (name, contact, tax/registration, category, payment terms) and complete its scorecard profile (quality / delivery / commercial / HSE weights).
2. **RFQ** — create an RFQ on GSI-EAM-001 for the DC cabling package with 2–3 bid lines (cable runs, connectors, cable management), realistic quantities and UoM.
3. **Bids + leveling** — enter comparative bids from the registered vendor plus 1–2 comparators, run TCO leveling, award one line.
4. **PO** — generate the PO from the award; size the awarded line so the PO value exceeds the $50k CFO threshold so the P-111 `po_threshold_finance` rule must fire. Capture the server-generated PO number and the approval instance ID, then decide the chain as finance_admin.
5. **Vendor portal** — as the vendor viewer, acknowledge the PO and propose a delivery window; confirm the expediting log row is created with `eta_confirmed = false`.
6. **Verification** — screenshot the PO detail page (approval trail + vendor ack event) and the expediting entry; query `audit_logs` to confirm a row for each mutation (vendor created, RFQ created, bids entered, award, PO created, approval decided, ack, delivery proposed).

### Report back
PO number, approval instance ID, vendor ack timestamp, expediting row id/state, audit_logs coverage table, and an explicit list of any gate that did **not** fire as expected (with the observed vs expected behaviour).

### Technical notes
- Driven with Playwright headless at 1280 width against `http://localhost:8080`, restoring the managed session; stable role/label selectors only.
- If a role gate blocks a step for the signed-in user, I stop and report it rather than bypassing with SQL or a role grant.
- No schema or business-logic changes are planned; if a genuine bug blocks the path I report it and propose the fix before touching code.
