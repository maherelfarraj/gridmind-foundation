## Goal

Complete the two remaining quickstart steps for the live GSI project **East Amman Hybrid PV + BESS** (`GSI-EAM-001`, id `d887fd69…`), all through the app UI/RPCs — no SQL-level writes:

1. Vendors LONGi + Trina Solar onboarded (status `onboarding`).
2. RFQ **RFQ-0001** — "65 MWp PV Module Supply — East Amman Hybrid Project", USD, both vendors invited, bid due 21 Aug 2026 17:00 Asia/Amman.
3. SCADA connector "East Amman SCADA Gateway" (REST push, gateway → GridMind) + production API key scoped `scada:telemetry:write`, with the 10 assets registered.

External references (`GSI-JOR-EAM-HYB-001`, `GSI-JOR-EAM-RFQ-MOD-001`) are carried as text in the RFQ title/terms and connector config — app codes stay `GSI-EAM-001` / `RFQ-0001` as you decided.

## Step 1 — Vendors (Procurement → Vendors → Onboard)

Create two vendors under GSI via the vendor form:

| Field      | LONGi                                   | Trina Solar           |
| ---------- | --------------------------------------- | --------------------- |
| Name       | LONGi                                   | Trina Solar           |
| Legal name | LONGi Green Energy Technology Co., Ltd. | Trina Solar Co., Ltd. |
| Country    | China                                   | China                 |
| Currency   | USD                                     | USD                   |
| Categories | modules                                 | modules               |
| Status     | onboarding                              | onboarding            |

Notes field records "Prequalification pending — PV module supply, East Amman (ext. ref GSI-JOR-EAM-HYB-001)".

Open item: you didn't give contact emails / payment terms / incoterms. I'll leave those blank and flag them — an RFQ invite without a vendor email means the bid link has to be delivered manually. Give me the two bid-desk emails and I'll fill them in the same pass.

## Step 2 — RFQ (Procurement → RFQs → New)

- Title: `65 MWp PV Module Supply — East Amman Hybrid Project`
- Project: East Amman Hybrid PV + BESS (`GSI-EAM-001`)
- Currency: USD
- Due date: `2026-08-21T17:00:00+03:00` (stored UTC `2026-08-21T14:00:00Z`)
- Terms/description: external RFQ ref `GSI-JOR-EAM-RFQ-MOD-001`, external project ref `GSI-JOR-EAM-HYB-001`, Incoterms + payment terms placeholder until you confirm.
- Line items: one module supply line at 65,000 kWp (I'll use a single lump line unless you want a per-tranche breakdown).
- Invite both vendors, then **Issue** → assigns `RFQ-0001` and moves status draft → issued.

## Step 3 — SCADA connector + API key

**API key** (Settings → API keys): name `East Amman SCADA Gateway (prod)`, scope `scada:telemetry:write` only — read/admin scopes off. Key is shown once; I'll hand it to you in chat at that moment and it is never retrievable again.

**Connector** (O&M → SCADA → Add connector): the connector-type enum has no `rest_push` value, so the closest supported type is used with the REST-push contract recorded in config:

```text
name            East Amman SCADA Gateway
project         GSI-EAM-001
type            vendor_api  (REST push)
config.direction    inbound_push  (site edge gateway → GridMind)
config.endpoint     POST https://gridmind-sparkle.lovable.app/api/public/hooks/scada-telemetry
config.headers      Authorization: Bearer <key>, X-GM-Timestamp, X-GM-Signature,
                    X-Project-Code: GSI-JOR-EAM-HYB-001
config.interval_sec 60
config.auth         api_key + HMAC-SHA256 (300 s replay window)
config.alarms       immediate
```

**Assets** — the `scada_asset_type` enum supports inverter / bess / meter / weather_station / plant_controller / combiner, so your 10 assets map like this:

| Asset                | asset_key     | type             |
| -------------------- | ------------- | ---------------- |
| PV array / inverters | `PV-INV-01`   | inverter         |
| BESS                 | `BESS-01`     | bess             |
| PCS                  | `BESS-PCS-01` | inverter         |
| BMS                  | `BESS-BMS-01` | bess             |
| EMS / PPC            | `EMS-PPC-01`  | plant_controller |
| POI meter            | `POI-MTR-01`  | meter            |
| MV switchgear        | `MV-SWGR-01`  | combiner         |
| Main transformer     | `TRF-MAIN-01` | combiner         |
| Weather station      | `WS-01`       | weather_station  |
| Substation           | `SUBSTN-01`   | plant_controller |

If you'd rather have exact `pcs` / `bms` / `transformer` / `switchgear` / `substation` enum values, that's a migration plus wizard/label updates — say so and I'll add it instead of mapping.

**Security prerequisite:** the public-hook guard checks a `cf-connecting-ip` allowlist and an HMAC secret. I need the site gateway's **public egress IP** to allowlist it; until then the guard runs in warn mode (window closes ≈ 8 Aug), after which unlisted IPs are rejected. The HMAC signing secret is generated with the key and shown once alongside it.

## Verification

- `psql` reads confirming: 2 GSI vendors `onboarding`; `rfqs` row status `issued`, `rfq_number = RFQ-0001`, due `2026-08-21T14:00:00Z`, 2 `rfq_bids` invites; 1 `scada_connectors` row + 10 `scada_assets` for the project.
- A signed sample POST to `/api/public/hooks/scada-telemetry` with one reading per asset, proving 200 + `accepted` count and that an unsigned/foreign-key request is rejected.
- Screenshots of the RFQ detail page and the SCADA connector page.

## Open items I need from you

1. LONGi / Trina bid-desk emails (and payment terms + incoterms if fixed).
2. Gateway public egress IP for the allowlist.
3. RFQ line breakdown — single 65 MWp line, or split by tranche/module type?
