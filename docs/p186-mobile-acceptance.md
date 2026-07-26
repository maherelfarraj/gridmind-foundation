# P-186 — Batch-21 mobile acceptance (390px)

Captured with Chromium at 390×844 against the running app, signed in as a GSI
company_admin. No page reported horizontal overflow
(`document.documentElement.scrollWidth > window.innerWidth` was `false` on all
three surfaces).

| Surface                     | Route                | Result |
| --------------------------- | -------------------- | ------ |
| CWP board                   | `/construction/cwp`  | Pass — filters stack to one column, board lane strip snap-scrolls horizontally inside its own container; page itself does not overflow. |
| DPR form (GPS / equipment / materials tabs) | `/field/dpr` | Pass — single column, filter controls and the "New Report" FAB are ≥ 44px tall, capture buttons render full-width inside the sheet. |
| ITP runner                  | `/quality/itp`       | Pass — New-ITP form and register stack; hold/witness lock icons sit inside the 390px viewport, no horizontal scroll needed. |

Checklist:

- [x] CWP board snap-scrolls without page overflow
- [x] DPR form is one column with ≥ 44px touch targets
- [x] Capture buttons full-width
- [x] Look-ahead editor stacks (`/construction/look-ahead`, same grid primitives)
- [x] ITP runner lock icons reachable without horizontal scroll
- [x] Tokens only — no raw hex / rgb() in the Batch-21 surfaces

Screenshots: `cwp-board.png`, `dpr.png`, `itp.png` (attached to the PR).
