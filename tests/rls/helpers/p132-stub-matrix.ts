// GC-18 — P-132 stub closure matrix.
//
// The eight `describe.skip` suites shipped with earlier batches (field core,
// construction governance, construction controls, materials & logistics,
// mobilization, planning baseline, rfq core, work orders) were placeholders:
// 75 tests that never executed. This matrix replaces the placeholder bodies
// with real, non-vacuous two-tenant probes driven by the same fixtures as the
// P-132 cross-tenant matrix:
//
//   1. the service-role client plants a row under company B,
//   2. user A (company_admin of company A) reads 0 rows scoped to company B,
//   3. user A's INSERT carrying company_id = B is rejected.
//
// A few tables hang off a parent row (manpower_logs → DPR, attendance → talk,
// reservations → inventory, bids/awards → RFQ). Those parents are seeded once
// per run under BOTH tenants by `seedStubParents`, so the child probes stay
// deterministic and never depend on suite ordering.

import type { Fixtures } from "./rls";

const rid = (n = 6) => crypto.randomUUID().slice(0, n).toUpperCase();

/**
 * `construction_daily_reports` is unique per (project, report_date, shift) and
 * `shift` is constrained to day/night, so probes pick a random date inside a
 * wide window rather than inventing a unique shift label.
 */
const randomReportDate = () => {
  const month = String(1 + Math.floor(Math.random() * 9)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `2027-${month}-${day}`;
};

export type StubParents = {
  dprB: string;
  dprA: string;
  talkB: string;
  talkA: string;
  invB: string;
  invA: string;
  rfqB: string;
  rfqA: string;
  bidB: string;
  bidA: string;
  /** Spare vendors so bid probes never collide with (rfq_id, vendor_id). */
  vendorB2: string;
  vendorB3: string;
};

/** Seed the parent rows the child-table probes reference, under A and B. */
export async function seedStubParents(f: Fixtures): Promise<StubParents> {
  const svc = f.svc;

  const dpr = async (companyId: string, projectId: string) => {
    const { data, error } = await svc
      .from("construction_daily_reports")
      .insert({
        company_id: companyId,
        project_id: projectId,
        report_date: randomReportDate(),
        shift: "day",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("dpr seed failed");
    return (data as { id: string }).id;
  };

  const talk = async (companyId: string, projectId: string) => {
    const { data, error } = await svc
      .from("toolbox_talks")
      .insert({
        company_id: companyId,
        project_id: projectId,
        tbt_number: `TBT-${rid()}`,
        talk_date: "2026-03-02",
        topic: "P132 closure probe",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("toolbox_talk seed failed");
    return (data as { id: string }).id;
  };

  const inv = async (companyId: string) => {
    const { data, error } = await svc
      .from("warehouse_inventory")
      .insert({
        company_id: companyId,
        sku: `SKU-${rid()}`,
        material: "P132 cable",
        uom: "m",
        qty_on_hand: 100,
      } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("warehouse_inventory seed failed");
    return (data as { id: string }).id;
  };

  const rfq = async (companyId: string, projectId: string) => {
    const { data, error } = await svc
      .from("rfqs")
      .insert({
        company_id: companyId,
        project_id: projectId,
        rfq_number: `RFQ-${rid()}`,
        title: "P132 closure RFQ",
        currency_code: "USD",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("rfq seed failed");
    return (data as { id: string }).id;
  };

  const bid = async (companyId: string, rfqId: string, vendorId: string) => {
    const { data, error } = await svc
      .from("rfq_bids")
      .insert({ company_id: companyId, rfq_id: rfqId, vendor_id: vendorId } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("rfq_bid seed failed");
    return (data as { id: string }).id;
  };

  const [dprB, dprA, talkB, talkA, invB, invA] = await Promise.all([
    dpr(f.B.companyId, f.B.projectId),
    dpr(f.A.companyId, f.A.projectId),
    talk(f.B.companyId, f.B.projectId),
    talk(f.A.companyId, f.A.projectId),
    inv(f.B.companyId),
    inv(f.A.companyId),
  ]);
  const vendor = async (companyId: string) => {
    const { data, error } = await svc
      .from("vendors")
      .insert({ company_id: companyId, name: `P132 vendor ${rid()}` } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("vendor seed failed");
    return (data as { id: string }).id;
  };

  const [vendorB2, vendorB3] = await Promise.all([vendor(f.B.companyId), vendor(f.B.companyId)]);

  const [rfqB, rfqA] = await Promise.all([
    rfq(f.B.companyId, f.B.projectId),
    rfq(f.A.companyId, f.A.projectId),
  ]);
  const [bidB, bidA] = await Promise.all([
    bid(f.B.companyId, rfqB, f.B.vendorId),
    bid(f.A.companyId, rfqA, f.A.vendorId),
  ]);

  return { dprB, dprA, talkB, talkA, invB, invA, rfqB, rfqA, bidB, bidA, vendorB2, vendorB3 };
}

export type StubSpec = {
  /** Original stub suite this row closes out. */
  origin: string;
  table: string;
  /** Row planted under company B with the service-role client. */
  seedForB: (f: Fixtures, p: StubParents) => Record<string, unknown>;
  /** Row user A tries to write into company B — RLS must reject it. */
  insertAsA: (f: Fixtures, p: StubParents) => Record<string, unknown>;
};

export const STUB_MATRIX: StubSpec[] = [
  // --- P-083 field core ---------------------------------------------------
  {
    origin: "field-core",
    table: "construction_daily_reports",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      report_date: randomReportDate(),
      shift: "day",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      report_date: randomReportDate(),
      shift: "night",
    }),
  },
  {
    origin: "field-core",
    table: "manpower_logs",
    seedForB: (f, p) => ({
      company_id: f.B.companyId,
      dpr_id: p.dprB,
      trade: "electrical",
      headcount: 4,
    }),
    insertAsA: (f, p) => ({
      company_id: f.B.companyId,
      dpr_id: p.dprB,
      trade: "hijack",
      headcount: 1,
    }),
  },
  {
    origin: "field-core",
    table: "field_observations",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      description: "P132 observation",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      description: "hijack observation",
    }),
  },
  {
    origin: "field-core",
    table: "weather_delays",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      delay_date: "2026-04-03",
      delay_type: "rain",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      delay_date: "2026-04-04",
      delay_type: "wind",
    }),
  },
  {
    origin: "field-core",
    table: "site_photos",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      file_path: `p132/${rid()}.jpg`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      file_path: `hijack/${rid()}.jpg`,
    }),
  },
  {
    origin: "field-core",
    table: "offline_queue",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      user_id: f.B.userId,
      client_idempotency_key: `p132-${crypto.randomUUID()}`,
      entity: "construction_daily_reports",
      action: "insert",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      user_id: f.B.userId,
      client_idempotency_key: `hijack-${crypto.randomUUID()}`,
      entity: "construction_daily_reports",
      action: "insert",
    }),
  },

  // --- P-182 construction governance --------------------------------------
  {
    origin: "governance",
    table: "method_statements",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      ms_number: `MS-${rid()}`,
      title: "P132 method statement",
      activity: "cable pulling",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      ms_number: `MS-${rid()}`,
      title: "hijack",
      activity: "hijack",
    }),
  },
  {
    origin: "governance",
    table: "toolbox_talks",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tbt_number: `TBT-${rid()}`,
      talk_date: "2026-03-10",
      topic: "P132 talk",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tbt_number: `TBT-${rid()}`,
      talk_date: "2026-03-11",
      topic: "hijack",
    }),
  },
  {
    origin: "governance",
    table: "toolbox_talk_attendance",
    seedForB: (f, p) => ({
      company_id: f.B.companyId,
      talk_id: p.talkB,
      worker_name: "P132 worker",
    }),
    insertAsA: (f, p) => ({
      company_id: f.B.companyId,
      talk_id: p.talkB,
      worker_name: "hijack worker",
    }),
  },
  {
    origin: "governance",
    table: "permits_to_work",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      ptw_number: `PTW-${rid()}`,
      permit_type: "hot_work",
      location: "Inverter yard",
      description: "P132 permit",
      valid_from: "2026-03-10T06:00:00Z",
      valid_to: "2026-03-10T18:00:00Z",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      ptw_number: `PTW-${rid()}`,
      permit_type: "electrical",
      location: "hijack",
      description: "hijack",
      valid_from: "2026-03-11T06:00:00Z",
      valid_to: "2026-03-11T18:00:00Z",
    }),
  },
  {
    origin: "governance",
    table: "site_instructions",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      si_number: `SI-${rid()}`,
      instruction: "P132 instruction",
      issued_to: "Contractor B",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      si_number: `SI-${rid()}`,
      instruction: "hijack",
      issued_to: "hijack",
    }),
  },
  {
    origin: "governance",
    table: "technical_queries",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tq_number: `TQ-${rid()}`,
      subject: "P132 query",
      question: "Which cable schedule applies?",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tq_number: `TQ-${rid()}`,
      subject: "hijack",
      question: "hijack",
    }),
  },

  // --- P-179 construction controls ----------------------------------------
  {
    origin: "cwp-controls",
    table: "construction_work_packages",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      cwp_number: `CWP-${rid()}`,
      title: "P132 package",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      cwp_number: `CWP-${rid()}`,
      title: "hijack package",
    }),
  },
  {
    origin: "cwp-controls",
    table: "look_ahead_plans",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      week_start: "2026-03-02",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      week_start: "2026-03-09",
    }),
  },
  {
    origin: "cwp-controls",
    table: "progress_weighting_rules",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      discipline: "civil",
      name: `Piling ${rid()}`,
      uom: "item",
      target_qty: 10,
      weight_pct: 25,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      discipline: "civil",
      name: `Hijack ${rid()}`,
      uom: "item",
      target_qty: 5,
      weight_pct: 10,
    }),
  },
  {
    origin: "cwp-controls",
    table: "delay_analysis",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      delay_date: "2026-03-04",
      cause: "weather",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      delay_date: "2026-03-05",
      cause: "access",
    }),
  },
  {
    origin: "cwp-controls",
    table: "recovery_plans",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      plan_number: `RCP-${rid()}`,
      title: "P132 recovery",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      plan_number: `RCP-${rid()}`,
      title: "hijack recovery",
    }),
  },

  // --- P-184 materials & logistics ----------------------------------------
  {
    origin: "materials-logistics",
    table: "material_take_offs",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      mto_number: `MTO-${rid()}`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      mto_number: `MTO-${rid()}`,
    }),
  },
  {
    origin: "materials-logistics",
    table: "warehouse_inventory",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      sku: `SKU-${rid()}`,
      material: "P132 conductor",
      uom: "m",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      sku: `SKU-${rid()}`,
      material: "hijack",
      uom: "m",
    }),
  },
  {
    origin: "materials-logistics",
    table: "site_inventory",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "P132 module",
      uom: "pcs",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "hijack",
      uom: "pcs",
    }),
  },
  {
    origin: "materials-logistics",
    table: "batch_serial_tracking",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      sku: `SKU-${rid()}`,
      batch_serial: `BS-${rid()}`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      sku: `SKU-${rid()}`,
      batch_serial: `BS-${rid()}`,
    }),
  },
  {
    origin: "materials-logistics",
    table: "material_reservations",
    seedForB: (f, p) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      reservation_number: `RES-${rid()}`,
      source: "warehouse",
      inventory_id: p.invB,
      qty: 5,
    }),
    insertAsA: (f, p) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      reservation_number: `RES-${rid()}`,
      source: "warehouse",
      inventory_id: p.invB,
      qty: 1,
    }),
  },
  {
    origin: "materials-logistics",
    table: "material_issuances",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      issue_number: `ISS-${rid()}`,
      sku: `SKU-${rid()}`,
      qty: 3,
      uom: "pcs",
      issued_to: "Crew B",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      issue_number: `ISS-${rid()}`,
      sku: `SKU-${rid()}`,
      qty: 1,
      uom: "pcs",
      issued_to: "hijack",
    }),
  },
  {
    origin: "materials-logistics",
    table: "shipment_tracking",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      shipment_number: `SHP-${rid()}`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      shipment_number: `SHP-${rid()}`,
    }),
  },
  {
    origin: "materials-logistics",
    table: "delivery_notes",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      dn_number: `DN-${rid()}`,
      received_date: "2026-03-12",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      dn_number: `DN-${rid()}`,
      received_date: "2026-03-13",
    }),
  },
  {
    origin: "materials-logistics",
    table: "shortage_alerts",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "P132 fuse",
      required_qty: 10,
      available_qty: 2,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "hijack",
      required_qty: 1,
      available_qty: 0,
    }),
  },
  {
    origin: "materials-logistics",
    table: "damaged_material_records",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "P132 module",
      qty: 2,
      damage_description: "Cracked glass in transit",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      sku: `SKU-${rid()}`,
      material: "hijack",
      qty: 1,
      damage_description: "hijack",
    }),
  },
  {
    origin: "materials-logistics",
    table: "return_to_vendor",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rtv_number: `RTV-${rid()}`,
      reason: "Damaged on arrival",
      qty: 2,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rtv_number: `RTV-${rid()}`,
      reason: "hijack",
      qty: 1,
    }),
  },

  // --- P-084 mobilization --------------------------------------------------
  {
    origin: "mobilization",
    table: "mobilization_checklists",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: `Mobilization ${rid()}`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: `Hijack ${rid()}`,
    }),
  },

  // --- P-071 planning baseline ---------------------------------------------
  {
    origin: "planning-baseline",
    table: "wbs_items",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      code: `WBS-${rid()}`,
      name: "P132 WBS",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      code: `WBS-${rid()}`,
      name: "hijack WBS",
    }),
  },
  {
    origin: "planning-baseline",
    table: "schedule_tasks",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: "P132 task",
      start_date: "2026-03-02",
      end_date: "2026-03-20",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: "hijack task",
      start_date: "2026-03-02",
      end_date: "2026-03-20",
    }),
  },
  {
    origin: "planning-baseline",
    table: "baseline_snapshots",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: `Baseline ${rid()}`,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: `Hijack baseline ${rid()}`,
    }),
  },
  {
    origin: "planning-baseline",
    table: "risks",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      title: "P132 risk",
      probability: 3,
      impact: 4,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      title: "hijack risk",
      probability: 2,
      impact: 2,
    }),
  },

  // --- P-092 rfq core -------------------------------------------------------
  {
    origin: "rfq-core",
    table: "rfqs",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rfq_number: `RFQ-${rid()}`,
      title: "P132 RFQ",
      currency_code: "USD",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rfq_number: `RFQ-${rid()}`,
      title: "hijack RFQ",
      currency_code: "USD",
    }),
  },
  {
    origin: "rfq-core",
    table: "rfq_bids",
    seedForB: (f, p) => ({
      company_id: f.B.companyId,
      rfq_id: p.rfqB,
      vendor_id: p.vendorB2,
    }),
    insertAsA: (f, p) => ({
      company_id: f.B.companyId,
      rfq_id: p.rfqB,
      vendor_id: p.vendorB3,
    }),
  },
  {
    origin: "rfq-core",
    table: "rfq_line_awards",
    seedForB: (f, p) => ({
      company_id: f.B.companyId,
      rfq_id: p.rfqB,
      rfq_bid_id: p.bidB,
      line_no: 1,
      awarded_qty: 10,
      awarded_unit_price: 5,
      awarded_amount: 50,
    }),
    insertAsA: (f, p) => ({
      company_id: f.B.companyId,
      rfq_id: p.rfqB,
      rfq_bid_id: p.bidB,
      line_no: 2,
      awarded_qty: 1,
      awarded_unit_price: 1,
      awarded_amount: 1,
    }),
  },

  // --- P-106 work orders ----------------------------------------------------
  {
    origin: "work-orders",
    table: "work_orders",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      wo_number: `WO-${rid()}`,
      title: "P132 work order",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      wo_number: `WO-${rid()}`,
      title: "hijack work order",
    }),
  },
];
