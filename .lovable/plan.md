## Real-operations quickstart — GSI

Verified current state: GSI (enterprise plan) has **0 projects, 0 project templates, 0 vendors, 0 API keys, 0 SCADA connectors**, and exactly one real user profile (`maher@next.jo`). So everything below is a genuine first-run.

### One conflict to resolve first

Project code is validated as **2–12 characters, A-Z / 0-9 / hyphen only** (both in the wizard schema and at creation time). Your proposed code `GSI-JOR-EAM-HYB-001` is 19 characters and will be rejected.

Proposal: use **`GSI-EAM-001`** (11 chars) as the system code, and keep the full `GSI-JOR-EAM-HYB-001` string as the project description/reference so nothing is lost. If you'd rather keep the long code as-is, say so and I'll widen the code rule instead (schema + DB) — that's a deliberate change, not a workaround.

### Step 1 — Create the project

Run the 4-step wizard for GSI:

- **Archetype:** Hybrid PV + BESS (`hybrid_pv_bess`)
- **Name:** East Amman 50 MW PV + 10 MW / 20 MWh BESS
- **Code:** `GSI-EAM-001`
- **Capacity:** `capacity_mw` = 50 (MWac point of interconnection), `capacity_mwh` = 20
- **Site:** Jordan — East Amman, Amman Governorate
- **Offtaker:** left blank (TBD)
- **Target COD:** 2028-12-31
- **Template:** none (no templates exist yet) → the wizard's blank selection: default gates, a single 100% budget line, departments preselected
- **Departments:** engineering, procurement, construction, HSE, finance
- **Team:** you as project admin; department leads left unset (no other GSI users hold `*_admin` roles yet — those dropdowns will be empty until invites are accepted, then leads get assigned in project settings)

The 65 MWp DC figure and the 10 MW BESS power rating live in the archetype config (PV + BESS config tabs), not the header capacity fields — I'll fill those on the project's configuration page right after creation.

Then tune the gates and budget so the project is actually usable: phase gates for Development → NTP → COD → Handover, and a first budget split (EPC / BOS / DEV / OWN) instead of the single placeholder line.

### Step 2 — Save it as GSI's reusable template

Because GSI has no templates, I'll capture this project's gates + budget structure as a `hybrid_pv_bess` project template for GSI, so the next project starts from it instead of blank.

### Step 3 — Real invites (waiting on your list)

Nothing issued until you send names + emails + intended roles. When you do, each invite goes through the guarded `create_invite` RPC under GSI (never SQL), and I hand back the accept links. Reminder of the standing rules: GSI is real people only, demo/test people stay in Sandbox, and if a guard blocks a grant I report it rather than routing around it. Note `super_admin` cannot be invited — only granted after signup.

### Step 4 — First vendor + RFQ (needs input)

I can onboard the vendor and open an RFQ against the new project as soon as you give me:

- Vendor: legal name, country, category (modules / BESS / EPC subcontract / transformers …), primary contact name + email, and any prequalification/certification notes
- RFQ: package title, scope lines (item, quantity, unit), bid due date, currency

Without a real vendor I would only be able to create a fixture, which is exactly what we agreed to keep out of GSI.

### Step 5 — SCADA connector (needs input)

Sequence when you're ready for telemetry:

1. Mint an API key in Settings → API keys with the `scada:ingest` scope (shown once — I'll hand it to you and it is never stored in plaintext), noting the HMAC signing secret and IP allowlist that the public-API guard enforces.
2. Create the SCADA connector row for the project with protocol and endpoint details.
3. Point the plant/gateway at `POST /api/public/hooks/scada-telemetry` using the signed-request scheme in `/docs/api`.

Needed from you: protocol (Modbus TCP / OPC-UA / REST poll / push), the source system (which inverter/BESS SCADA vendor), the static egress IP(s) to allowlist, and the asset/point list to map.

Also worth flagging: the API guard is still in **warn** mode (Day 0 of the warn window, flip ≈ Aug 8). A connector onboarded before the flip will start failing after it if its signing or IP config is wrong, so I'll verify the first signed request end-to-end rather than assuming warn-mode success.

### What I'll do in this pass

Steps 1 and 2 in full (project created, configured, gates and budget set, template saved), then verified in the running app with a screenshot of the project dashboard. Steps 3–5 are blocked on the inputs above; I'll write a short operator runbook for each into `docs/` so the sequence is captured even before the data arrives.

### Technical notes

- Project creation goes through the existing `createProject` server function (RLS-scoped, audit-logged), driven through the real wizard UI rather than direct inserts, so guards, phase-gate seeding, and audit rows all behave as they will for your team.
- Templates, vendors, and RFQs are data operations on existing tables — no schema changes expected. The only scenario needing a migration is widening the project-code rule, if you choose that over the shorter code.
