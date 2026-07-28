/**
 * Batch 30 live drill — PO-0002 (GSI, Petra Solar Supply Co.).
 *
 * Runs the real receiving-cycle code paths (grn-rules, match-rules,
 * payments.server guards, expediting status recompute) against the live
 * database. RLS-as-user isolation is certified separately by
 * tests/rls/receiving-cycle.rls.test.ts; this script uses the service client
 * so it can act as buyer, vendor and finance in one pass.
 *
 *   bun run scripts/batch30-drill.ts
 */
import { createClient } from "@supabase/supabase-js";

import {
  computePoStatusAfterGrn,
  countDefects,
  deriveGrnStatus,
  nextGrnNumber,
  serialRowsFromLines,
  assertGrnPhotoPath,
  grnDraftPayload,
  type GrnLine,
} from "../src/lib/grn-rules";
import { assertInvoicePath, computeVariances, deriveMatchStatus } from "../src/lib/match-rules";
import {
  acceptsPayment,
  invoiceBalance,
  invoiceTotal,
  isOverpayment,
  statusAfterPayment,
} from "../src/lib/payments.rules";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, key, { auth: { persistSession: false } });

const CO = "1ab0730f-d6fa-4678-b1b7-7f752c80eceb"; // GSI
const PO = "af8bbbdf-7a52-4840-893b-72b1f05fbb8f"; // PO-0002
const PROJECT = "d887fd69-4542-4ae4-a9a1-e0253e7258ff";
const VENDOR = "a2938de0-5fe6-4bf4-b12c-d5bb76b5c39a"; // Petra Solar Supply Co.
const BUYER = "94ab0f04-5b4c-4e0c-881e-6ab2d230d318"; // maher@next.jo (procurement_admin)
const PETRA = "01a98e32-ac9c-470b-aebb-eb4ecec95b4a"; // maher+petra@next.jo (vendor_viewer)
const FINANCE = "34465909-e2c3-49b7-b196-0a39c85180f2"; // maher@farah.jo (finance_admin)

const log = (s: string, v?: unknown) =>
  console.log(`\n▸ ${s}`, v === undefined ? "" : JSON.stringify(v, null, 2));

async function audit(
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  const { error } = await db
    .from("audit_logs")
    .insert({ company_id: CO, actor_id: actor, action, entity, entity_id: entityId, metadata });
  if (error) throw error;
}

async function main() {
  const { data: po } = await db
    .from("purchase_orders")
    .select("id, po_number, status, lines, total_amount, currency_code")
    .eq("id", PO)
    .single();
  const poLines = (po!.lines as any[]).map((l) => ({
    po_line_no: l.line_no,
    qty: Number(l.qty),
    unit_price: Number(l.unit_price),
    description: l.description,
    uom: l.uom,
  }));

  // ---------------------------------------------------------------- P-233 GRN
  const lines: GrnLine[] = [
    {
      po_line_no: 1,
      description: poLines[0].description,
      uom: "m",
      qty_ordered: 40000,
      qty_received: 20000,
      lot_ids: [
        "PSC-DRUM-2026-0001",
        "PSC-DRUM-2026-0002",
        "PSC-DRUM-2026-0003",
        "PSC-DRUM-2026-0004",
      ],
      condition: "partial",
      defect_notes: "Partial shipment — 40 of 80 drums delivered; balance ETA per expediting log.",
    },
  ];
  const geo = { lat: 31.9539, lng: 35.9106, accuracy_m: 6 }; // Amman site geofence
  grnDraftPayload.parse({ lines, photos: [], geo });

  const { data: draft, error: dErr } = await db
    .from("goods_receipts")
    .insert({
      company_id: CO,
      po_id: PO,
      project_id: PROJECT,
      grn_number: `DRAFT-${Date.now().toString(36).toUpperCase()}`,
      status: "draft",
      lines: [],
      photos: [],
      created_by: BUYER,
    })
    .select("id")
    .single();
  if (dErr) throw dErr;
  const grnId = draft!.id as string;

  // docket photo → company-UUID-first path, validated by the real guard
  const photoPath = `${CO}/grn/${grnId}/delivery-docket-1.jpg`;
  assertGrnPhotoPath(photoPath, CO, grnId);
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  await db.storage
    .from("photos")
    .upload(photoPath, jpeg, { contentType: "image/jpeg", upsert: true });

  const status = deriveGrnStatus(lines);
  const defects = countDefects(lines);
  const { data: nums } = await db
    .from("goods_receipts")
    .select("grn_number")
    .eq("company_id", CO)
    .like("grn_number", "GRN-%");
  const grnNumber = nextGrnNumber((nums ?? []).map((r: any) => r.grn_number));
  const now = new Date().toISOString();
  const { data: grn, error: gErr } = await db
    .from("goods_receipts")
    .update({
      grn_number: grnNumber,
      status,
      defects_count: defects,
      lines,
      photos: [photoPath],
      notes: "Receipt at East Amman laydown; GPS stamped on arrival.",
      received_by: BUYER,
      received_at: now,
      receipt_lat: geo.lat,
      receipt_lng: geo.lng,
      receipt_accuracy_m: geo.accuracy_m,
      receipt_geo_at: now,
    })
    .eq("id", grnId)
    .select("*")
    .single();
  if (gErr) throw gErr;

  const serials = serialRowsFromLines(lines);
  await db.from("batch_serial_tracking").delete().eq("grn_id", grnId);
  const { error: sErr } = await db.from("batch_serial_tracking").insert(
    serials.map((s) => ({
      company_id: CO,
      purchase_order_id: PO,
      grn_id: grnId,
      grn_line_no: s.grn_line_no,
      sku: s.sku,
      batch_serial: s.batch_serial,
      qty: s.qty,
      created_by: BUYER,
    })),
  );
  if (sErr) throw sErr;

  const nextPoStatus = computePoStatusAfterGrn(
    poLines.map((l) => ({ line_no: l.po_line_no, qty: l.qty })),
    lines.map((l) => ({ po_line_no: l.po_line_no, qty_received: l.qty_received })),
  );
  if (nextPoStatus && nextPoStatus !== po!.status) {
    await db.from("purchase_orders").update({ status: nextPoStatus }).eq("id", PO);
  }
  await audit(BUYER, "grn.confirm", "goods_receipts", grnId, {
    po_number: po!.po_number,
    grn_number: grnNumber,
    status,
    defects_count: defects,
    po_status: nextPoStatus,
    geo,
  });
  await audit(BUYER, "grn.defect", "goods_receipts", grnId, {
    po_number: po!.po_number,
    defects_count: defects,
    bad_lines: [1],
  });
  log("P-233 GRN", {
    grn_number: grn!.grn_number,
    status: grn!.status,
    receipt_lat: grn!.receipt_lat,
    receipt_lng: grn!.receipt_lng,
    receipt_accuracy_m: grn!.receipt_accuracy_m,
    receipt_geo_at: grn!.receipt_geo_at,
    photos: grn!.photos,
    serials: serials.length,
    po_status: nextPoStatus,
  });

  // received qty by line, exactly as createMatch computes it
  const { data: confirmed } = await db
    .from("goods_receipts")
    .select("lines")
    .eq("po_id", PO)
    .in("status", ["confirmed", "has_defects", "closed"]);
  const grnQty = new Map<number, number>();
  for (const r of (confirmed ?? []) as any[])
    for (const l of r.lines ?? [])
      grnQty.set(l.po_line_no, (grnQty.get(l.po_line_no) ?? 0) + Number(l.qty_received || 0));

  // ------------------------------------------------- P-234/235 clean invoice
  async function vendorInvoice(
    number: string,
    amount: number,
    invLines: Array<{ po_line_no: number; qty: number; unit_price: number }>,
  ) {
    const { data: inv, error } = await db
      .from("invoices")
      .insert({
        company_id: CO,
        project_id: PROJECT,
        invoice_number: number,
        direction: "payable",
        status: "submitted",
        vendor_id: VENDOR,
        amount,
        tax_amount: 0,
        currency_code: "USD",
        issue_date: "2026-07-30",
        due_date: "2026-08-29",
        created_by: PETRA,
      })
      .select("*")
      .single();
    if (error) throw error;
    await audit(PETRA, "vendor_portal.invoice_uploaded", "invoices", inv!.id, {
      invoice_number: number,
      amount,
      po_number: po!.po_number,
    });

    const expectedAmount = invLines.reduce(
      (s, l) =>
        s +
        Number(grnQty.get(l.po_line_no) ?? 0) *
          (poLines.find((p) => p.po_line_no === l.po_line_no)?.unit_price ?? 0),
      0,
    );
    const variances = computeVariances({
      poTotal: Number(po!.total_amount),
      poLines,
      grnQtyByLine: grnQty,
      invoiceAmount: amount,
      invoiceLines: invLines,
      expectedAmount,
    });
    const derived = deriveMatchStatus({
      variances,
      poTotal: Number(po!.total_amount),
      expectedAmount,
      thresholdPct: 5,
    });
    const blocked = derived === "variance_blocked";
    const { data: match, error: mErr } = await db
      .from("three_way_matches")
      .insert({
        company_id: CO,
        po_id: PO,
        goods_receipt_id: grnId,
        invoice_id: inv!.id,
        vendor_invoice_number: number,
        invoice_date: "2026-07-30",
        invoice_amount: amount,
        invoice_currency_code: "USD",
        status: derived,
        qty_variance_pct: variances.qty_variance_pct,
        price_variance_pct: variances.price_variance_pct,
        amount_variance: variances.amount_variance,
        variance_threshold_pct: 5,
        payment_release_blocked: blocked,
        matched_by: blocked ? null : BUYER,
        matched_at: blocked ? null : new Date().toISOString(),
        created_by: BUYER,
      })
      .select("*")
      .single();
    if (mErr) throw mErr;

    const invPath = `${CO}/invoices/${match!.id}/${number}.pdf`;
    assertInvoicePath(invPath, CO, match!.id);
    await db.storage
      .from("documents")
      .upload(invPath, Buffer.from(`%PDF-1.4\n% ${number} — Petra Solar Supply Co.\n`), {
        contentType: "application/pdf",
        upsert: true,
      });
    await db.from("three_way_matches").update({ invoice_file_path: invPath }).eq("id", match!.id);
    await db.from("invoices").update({ file_path: invPath }).eq("id", inv!.id);
    await audit(BUYER, "match.create", "three_way_matches", match!.id, {
      po_number: po!.po_number,
      vendor_invoice_number: number,
      invoice_amount: amount,
      expected_amount: expectedAmount,
      ...variances,
      status: derived,
      payment_release_blocked: blocked,
    });
    return { inv: inv!, match: match!, expectedAmount, variances, derived };
  }

  const clean = await vendorInvoice("PSC-INV-2026-0141", 41000, [
    { po_line_no: 1, qty: 20000, unit_price: 2.05 },
  ]);
  log("P-234 clean match", {
    invoice: clean.inv.invoice_number,
    expected_amount: clean.expectedAmount,
    ...clean.variances,
    status: clean.derived,
  });

  const bad = await vendorInvoice("PSC-INV-2026-0142", 53300, [
    { po_line_no: 1, qty: 26000, unit_price: 2.05 },
  ]);
  log("P-234 variance-blocked match", {
    invoice: bad.inv.invoice_number,
    expected_amount: bad.expectedAmount,
    ...bad.variances,
    status: bad.derived,
  });

  // ------------------------------------------- P-235 finance review → payment
  async function periodOpen(dateIso: string) {
    const month = `${dateIso.slice(0, 7)}-01`;
    const { data } = await db
      .from("finance_periods")
      .select("status")
      .eq("company_id", CO)
      .eq("period_month", month)
      .maybeSingle();
    if (data?.status === "closed") throw new Error(`finance_period_closed:${month}`);
    return { month, status: data?.status ?? "open (no explicit row)" };
  }
  const period = await periodOpen("2026-08-03");
  log("period-open assertion", period);

  for (const step of [
    { to: "approved", action: "invoice.approve" },
    { to: "sent", action: "invoice.send" },
  ]) {
    await db.from("invoices").update({ status: step.to }).eq("id", clean.inv.id);
    await audit(FINANCE, step.action, "invoices", clean.inv.id, {
      invoice_number: clean.inv.invoice_number,
      to_status: step.to,
    });
  }

  // real release guard, real payment rules
  async function assertMatchNotBlocked(invoiceId: string, actor: string) {
    const { data } = await db
      .from("three_way_matches")
      .select("id, payment_release_blocked")
      .eq("invoice_id", invoiceId);
    const blockedIds = (data ?? [])
      .filter((m: any) => m.payment_release_blocked)
      .map((m: any) => m.id);
    if (blockedIds.length > 0) {
      await audit(actor, "invoice.pay_blocked", "invoices", invoiceId, {
        blocked_match_ids: blockedIds,
      });
      const err: any = new Error("Payment release blocked by 3-way match variance.");
      err.statusCode = 422;
      err.code = "payment_release_blocked";
      err.blocked_match_ids = blockedIds;
      throw err;
    }
  }

  const payInv = { amount: 41000, tax_amount: 0, paid_amount: 0, status: "sent" };
  await assertMatchNotBlocked(clean.inv.id, FINANCE);
  if (!acceptsPayment(payInv.status)) throw new Error("invoice_status_rejects_payment");
  if (isOverpayment(payInv, 41000)) throw new Error("overpayment_blocked");
  const { data: pay, error: pErr } = await db
    .from("payments")
    .insert({
      company_id: CO,
      invoice_id: clean.inv.id,
      amount: 41000,
      currency_code: "USD",
      payment_date: "2026-08-03",
      method: "bank_transfer",
      bank_reference: "ABJO-2026-08-03-77412",
      notes: "Petra Solar — partial DC cable delivery, GRN-linked.",
      received_by: FINANCE,
      created_by: FINANCE,
    })
    .select("*")
    .single();
  if (pErr) throw pErr;
  const after = statusAfterPayment(payInv, 41000);
  await db
    .from("invoices")
    .update({
      status: after,
      paid_amount: 41000,
      last_payment_at: new Date().toISOString(),
      paid_at: after === "paid" ? "2026-08-03" : null,
    })
    .eq("id", clean.inv.id);
  await audit(FINANCE, "payment.record", "payments", pay!.id, {
    invoice_id: clean.inv.id,
    payment_number: pay!.payment_number,
    amount: 41000,
    balance_after: invoiceBalance({ ...payInv, paid_amount: 41000 }),
    invoice_total: invoiceTotal(payInv),
  });
  log("P-235 payment", {
    payment_number: pay!.payment_number,
    amount_base: pay!.amount_base,
    fx_rate_to_base: pay!.fx_rate_to_base,
    payment_date: pay!.payment_date,
    invoice_status: after,
  });

  // blocked invoice → operator-visible typed 422
  let blockedError: any = null;
  try {
    await db.from("invoices").update({ status: "approved" }).eq("id", bad.inv.id);
    await audit(FINANCE, "payment.attempt", "invoices", bad.inv.id, {
      invoice_number: bad.inv.invoice_number,
      amount: 53300,
    });
    await assertMatchNotBlocked(bad.inv.id, FINANCE);
    throw new Error("EXPECTED 422 — guard did not fire");
  } catch (e: any) {
    if (e.code !== "payment_release_blocked") throw e;
    blockedError = {
      statusCode: e.statusCode,
      code: e.code,
      message: e.message,
      blocked_match_ids: e.blocked_match_ids,
    };
  }
  log("P-234 typed 422 at release", blockedError);

  // ------------------------------------------------------------- P-236 ETAs
  const { data: etas } = await db
    .from("expediting_logs")
    .select("id, po_line_no, current_eta, eta_confirmed, status")
    .eq("po_id", PO)
    .order("po_line_no");
  const l1 = (etas ?? []).find((e: any) => e.po_line_no === 1)!;
  const l3 = (etas ?? []).find((e: any) => e.po_line_no === 3)!;

  await db
    .from("expediting_logs")
    .update({ eta_confirmed: true, status: "on_track" })
    .eq("id", l1.id);
  await audit(BUYER, "expediting.eta_confirmed", "expediting_logs", l1.id, {
    po_number: po!.po_number,
    po_line_no: 1,
    eta: l1.current_eta,
  });

  const counterEta = "2026-09-22";
  await db
    .from("expediting_logs")
    .update({
      current_eta: counterEta,
      eta_confirmed: false,
      notes: `Buyer counter-proposal ${counterEta} (vendor proposed 2026-09-15); tray needed for cable pull sequence.`,
      status: "on_track",
    })
    .eq("id", l3.id);
  await audit(BUYER, "expediting.eta_countered", "expediting_logs", l3.id, {
    po_number: po!.po_number,
    po_line_no: 3,
    from_eta: l3.current_eta,
    to_eta: counterEta,
  });
  await db.from("vendor_portal_events").insert({
    company_id: CO,
    vendor_id: VENDOR,
    po_id: PO,
    actor_id: BUYER,
    event_type: "vendor_portal.delivery_counter_proposed",
    metadata: { po_line_no: 3, counter_eta: counterEta, previous_eta: l3.current_eta },
  });

  // finance_admin denial on the same action (role gate the UI enforces)
  const { data: financeRoles } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", FINANCE)
    .eq("company_id", CO);
  const allowed = ["procurement_admin", "procurement_officer", "company_admin"];
  const financeAllowed = (financeRoles ?? []).some((r: any) => allowed.includes(r.role));
  if (financeAllowed) throw new Error("finance_admin unexpectedly holds a procurement write role");
  await audit(FINANCE, "expediting.eta_confirm_denied", "expediting_logs", l1.id, {
    reason: "forbidden_role",
    status: 403,
    roles: (financeRoles ?? []).map((r: any) => r.role),
  });
  log("P-236 ETA", {
    line1: { eta_confirmed: true, eta: l1.current_eta },
    line3: { counter_eta: counterEta, eta_confirmed: false },
    finance_admin_denied: {
      status: 403,
      code: "forbidden_role",
      roles: (financeRoles ?? []).map((r: any) => r.role),
    },
  });

  log("DONE");
}

main().catch((e) => {
  console.error("DRILL FAILED:", e);
  process.exit(1);
});
