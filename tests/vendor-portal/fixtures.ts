// P-226 — Typed fixtures + an offline harness that mirrors the shipped
// vendor-portal SECURITY DEFINER RPCs (migrations 0089/0090).
//
// No network, no Supabase: memberships/POs/expediting/invoices are plain rows
// and each `rpc.*` function reproduces the SQL semantics (guards, error codes,
// event/notification/audit side effects) so every denial path is asserted.

import type { VendorExposure } from "@/lib/vendor-portal.rules";
import { DEFAULT_VENDOR_EXPOSURE, type VendorMembershipStatus } from "@/lib/vendor-portal.rules";
import {
  scanVendorUpload,
  validateUploadFile,
  VENDOR_INVOICE_MIME,
} from "@/lib/vendor-uploads.rules";

export const NOW = "2026-07-27T09:00:00.000Z";

export const COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const COMPANY_B = "bbbbbbbb-0000-4000-8000-000000000001";
export const VENDOR_A = "11111111-0000-4000-8000-00000000000a";
export const VENDOR_B = "22222222-0000-4000-8000-00000000000b";
export const USER_VENDOR_A = "99999999-0000-4000-8000-0000000000a1";
export const USER_VENDOR_B = "99999999-0000-4000-8000-0000000000b1";
export const USER_INTERNAL = "77777777-0000-4000-8000-000000000001";
export const PO_A = "40000000-0000-4000-8000-00000000000a";
export const PO_B = "40000000-0000-4000-8000-00000000000b";
export const PO_CROSS_TENANT = "40000000-0000-4000-8000-00000000000c";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface MembershipFixture {
  id: string;
  company_id: string;
  vendor_id: string;
  email: string;
  user_id: string | null;
  status: VendorMembershipStatus;
  exposure: VendorExposure;
  expires_at: string | null;
  last_seen_at: string | null;
}

export function makeMembership(overrides: Partial<MembershipFixture> = {}): MembershipFixture {
  return {
    id: "mem-a",
    company_id: COMPANY_A,
    vendor_id: VENDOR_A,
    email: "seller@vendor-a.test",
    user_id: USER_VENDOR_A,
    status: "active",
    exposure: { ...DEFAULT_VENDOR_EXPOSURE },
    expires_at: null,
    last_seen_at: null,
    ...overrides,
  };
}

export const EXPIRED_AT = "2026-07-01T00:00:00.000Z";
export const FUTURE_AT = "2027-01-01T00:00:00.000Z";

export interface PoLineFixture {
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  site_need_date?: string | null;
}

export interface PoFixture {
  id: string;
  company_id: string;
  vendor_id: string;
  project_id: string | null;
  po_number: string;
  status: string;
  currency_code: string;
  total_amount: number;
  issued_at: string | null;
  created_at: string;
  required_by_date: string | null;
  lines: PoLineFixture[];
  acknowledged_at?: string | null;
  acknowledged_by_email?: string | null;
  acknowledgment_note?: string | null;
  acknowledgment_status?: string | null;
}

export function makePo(overrides: Partial<PoFixture> = {}): PoFixture {
  return {
    id: PO_A,
    company_id: COMPANY_A,
    vendor_id: VENDOR_A,
    project_id: "proj-a",
    po_number: "PO-0001",
    status: "issued",
    currency_code: "JOD",
    total_amount: 125_000,
    issued_at: "2026-07-10T00:00:00.000Z",
    created_at: "2026-07-09T00:00:00.000Z",
    required_by_date: "2026-09-30",
    lines: [
      { line_no: 1, description: "PV modules 580 Wp", quantity: 1000, unit_price: 100 },
      { line_no: 2, description: "String combiners", quantity: 20, unit_price: 1250 },
    ],
    acknowledged_at: null,
    acknowledged_by_email: null,
    acknowledgment_note: null,
    acknowledgment_status: null,
    ...overrides,
  };
}

export interface ExpeditingFixture {
  id: string;
  company_id: string;
  po_id: string;
  project_id: string | null;
  po_line_no: number;
  item_description: string;
  site_need_date: string | null;
  current_eta: string | null;
  eta_confirmed: boolean;
  last_vendor_contact_at: string | null;
  notes: string | null;
}

export function makeExpediting(overrides: Partial<ExpeditingFixture> = {}): ExpeditingFixture {
  return {
    id: "exp-1",
    company_id: COMPANY_A,
    po_id: PO_A,
    project_id: "proj-a",
    po_line_no: 1,
    item_description: "PV modules 580 Wp",
    site_need_date: "2026-09-30",
    current_eta: null,
    eta_confirmed: false,
    last_vendor_contact_at: null,
    notes: null,
    ...overrides,
  };
}

export interface InvoiceFixture {
  id: string;
  company_id: string;
  po_id: string;
  vendor_invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number;
  invoice_currency_code: string;
  invoice_file_path: string;
  status: string;
  created_by: string | null;
}

export function makeInvoice(overrides: Partial<InvoiceFixture> = {}): InvoiceFixture {
  return {
    id: "match-1",
    company_id: COMPANY_A,
    po_id: PO_A,
    vendor_invoice_number: "INV-77",
    invoice_date: "2026-07-20",
    invoice_amount: 50_000,
    invoice_currency_code: "JOD",
    invoice_file_path: `${COMPANY_A}/vendor-invoices/${VENDOR_A}/${PO_A}/1_inv.pdf`,
    status: "pending",
    created_by: USER_VENDOR_A,
    ...overrides,
  };
}

export interface UserRoleFixture {
  user_id: string;
  company_id: string;
  role: string;
}

export const PROCUREMENT_ROLES: UserRoleFixture[] = [
  { user_id: "user-proc-admin", company_id: COMPANY_A, role: "procurement_admin" },
  { user_id: "user-proc-officer", company_id: COMPANY_A, role: "procurement_officer" },
  { user_id: "user-finance", company_id: COMPANY_A, role: "finance_admin" },
  { user_id: "user-other-tenant", company_id: COMPANY_B, role: "procurement_admin" },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface PortalEventRow {
  id: string;
  company_id: string;
  vendor_id: string;
  actor_type: "vendor" | "internal" | "system";
  actor_id: string | null;
  membership_id: string | null;
  event: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NotificationRow {
  company_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string;
}

export interface AuditRow {
  action: string;
  entity: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}

export interface HarnessOptions {
  memberships?: MembershipFixture[];
  pos?: PoFixture[];
  expediting?: ExpeditingFixture[];
  invoices?: InvoiceFixture[];
  userRoles?: UserRoleFixture[];
  /** auth.uid() for the simulated session. */
  authUid?: string | null;
  /** Companies the caller is a member of (is_company_member). */
  memberOf?: string[];
  /** is_external_viewer() */
  external?: boolean;
  now?: string;
}

export class PortalDenied extends Error {}

function deny(code: string): never {
  throw new PortalDenied(code);
}

export function createPortalHarness(opts: HarnessOptions = {}) {
  const now = opts.now ?? NOW;
  const authUid = opts.authUid === undefined ? USER_VENDOR_A : opts.authUid;
  const memberOf = opts.memberOf ?? [];
  const external = opts.external ?? false;

  const db = {
    memberships: (opts.memberships ?? [makeMembership()]).map((m) => ({ ...m })),
    purchase_orders: (opts.pos ?? [makePo()]).map((p) => ({ ...p })),
    expediting_logs: (opts.expediting ?? []).map((e) => ({ ...e })),
    three_way_matches: (opts.invoices ?? []).map((i) => ({ ...i })),
    user_roles: opts.userRoles ?? PROCUREMENT_ROLES,
    vendor_portal_events: [] as PortalEventRow[],
    notifications: [] as NotificationRow[],
    audit_logs: [] as AuditRow[],
  };

  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  /** public.vendor_portal_assert_access(p_vendor_id) */
  function assertAccess(vendorId: string): MembershipFixture {
    const row = db.memberships.find(
      (m) =>
        m.vendor_id === vendorId &&
        m.user_id === authUid &&
        authUid !== null &&
        m.status === "active" &&
        (m.expires_at === null || m.expires_at > now),
    );
    if (!row) deny("vendor_portal_access_denied");
    row.last_seen_at = now;
    return row;
  }

  /** public.vendor_portal_write_event(...) — dual path. */
  function writeEvent(
    vendorId: string,
    event: string,
    metadata: Record<string, unknown> = {},
    companyId: string | null = null,
  ): string {
    const seat = db.memberships.find(
      (m) =>
        m.vendor_id === vendorId &&
        m.user_id === authUid &&
        authUid !== null &&
        m.status === "active" &&
        (m.expires_at === null || m.expires_at > now),
    );

    let company: string | null;
    let actorType: PortalEventRow["actor_type"];
    let membershipId: string | null;

    if (seat) {
      company = seat.company_id;
      actorType = "vendor";
      membershipId = seat.id;
    } else {
      if (external) deny("vendor_portal_access_denied");
      company =
        companyId ?? db.memberships.find((m) => m.vendor_id === vendorId)?.company_id ?? null;
      if (!company || !memberOf.includes(company)) deny("vendor_portal_access_denied");
      actorType = "internal";
      membershipId = null;
    }

    const row: PortalEventRow = {
      id: nextId("evt"),
      company_id: company,
      vendor_id: vendorId,
      actor_type: actorType,
      actor_id: authUid,
      membership_id: membershipId,
      event,
      metadata,
      created_at: now,
    };
    db.vendor_portal_events.push(row);
    return row.id;
  }

  function notifyProcurement(
    companyId: string,
    n: Omit<NotificationRow, "company_id" | "user_id">,
  ) {
    for (const r of db.user_roles) {
      if (r.company_id !== companyId) continue;
      if (!["procurement_admin", "procurement_officer"].includes(r.role)) continue;
      db.notifications.push({ company_id: companyId, user_id: r.user_id, ...n });
    }
  }

  function audit(
    action: string,
    entity: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    db.audit_logs.push({ action, entity, entity_id: entityId, metadata });
  }

  /** public.vendor_portal_acknowledge_po(p_po_id, p_decision, p_comment) */
  function acknowledgePo(poId: string, decision: string, comment: string | null = null): void {
    const DECISIONS = ["accepted", "accepted_with_comments", "rejected"];
    if (!DECISIONS.includes(decision)) deny("invalid_decision");
    if (
      (decision === "accepted_with_comments" || decision === "rejected") &&
      !(comment ?? "").trim()
    ) {
      deny("comment_required");
    }

    const po = db.purchase_orders.find((p) => p.id === poId);
    if (!po) deny("po_not_found");

    const seat = assertAccess(po.vendor_id);
    if (!seat.exposure.pos) deny("vendor_portal_pos_not_exposed");
    if (seat.company_id !== po.company_id) deny("vendor_portal_access_denied");
    if (!["issued", "partially_received"].includes(po.status)) deny("po_not_acknowledgeable");

    po.acknowledged_at = now;
    po.acknowledged_by_email = seat.email;
    po.acknowledgment_note = comment;
    po.acknowledgment_status = decision;

    writeEvent(po.vendor_id, "vendor_portal.po_acknowledged", {
      po_id: poId,
      po_number: po.po_number,
      decision,
    });
    notifyProcurement(po.company_id, {
      type: "vendor_portal",
      title: `Vendor acknowledged ${po.po_number}: ${decision.replace(/_/g, " ")}`,
      body: comment ?? "",
      link: `/procurement/pos/${poId}`,
    });
    audit("vendor_portal.po_acknowledged", "purchase_orders", poId, {
      decision,
      vendor_id: po.vendor_id,
      by: seat.email,
    });
  }

  /** public.vendor_portal_propose_delivery(p_po_id, p_lines) */
  function proposeDelivery(
    poId: string,
    lines: Array<{ line_no?: number; proposed_date?: string; note?: string }>,
  ): number {
    const po = db.purchase_orders.find((p) => p.id === poId);
    if (!po) deny("po_not_found");

    const seat = assertAccess(po.vendor_id);
    if (!seat.exposure.deliveries) deny("deliveries_not_exposed");
    if (!Array.isArray(lines) || lines.length === 0) deny("lines_required");

    const issue = (po.issued_at ?? po.created_at).slice(0, 10);
    let n = 0;

    for (const line of lines) {
      if (!line.proposed_date) deny("proposed_date_required");
      if (line.line_no == null) deny("line_not_on_po");
      if (line.proposed_date < issue) deny("proposed_date_before_issue");
      const poLine = po.lines.find((l) => l.line_no === line.line_no);
      if (!poLine) deny("line_not_on_po");

      const note = `Vendor-proposed${line.note?.trim() ? ` — ${line.note.trim()}` : ""}`;
      const existing = db.expediting_logs.find(
        (e) => e.po_id === po.id && e.po_line_no === line.line_no,
      );
      if (existing) {
        existing.current_eta = line.proposed_date;
        existing.eta_confirmed = false;
        existing.last_vendor_contact_at = now;
        existing.notes = note;
      } else {
        db.expediting_logs.push({
          id: nextId("exp"),
          company_id: po.company_id,
          po_id: po.id,
          project_id: po.project_id,
          po_line_no: line.line_no,
          item_description: poLine.description || `PO line ${line.line_no}`,
          site_need_date: poLine.site_need_date ?? po.required_by_date ?? line.proposed_date,
          current_eta: line.proposed_date,
          eta_confirmed: false,
          last_vendor_contact_at: now,
          notes: note,
        });
      }
      n += 1;
    }

    writeEvent(
      po.vendor_id,
      "vendor_portal.delivery_proposed",
      { po_id: poId, po_number: po.po_number, lines, line_count: n },
      po.company_id,
    );
    notifyProcurement(po.company_id, {
      type: "expediting",
      title: `Vendor proposed delivery dates on ${po.po_number}`,
      body: `${n} line(s) updated — review in expediting`,
      link: "/procurement/expediting",
    });
    audit("vendor_portal.delivery_proposed", "purchase_orders", poId, {
      vendor_id: po.vendor_id,
      line_count: n,
    });
    return n;
  }

  /** public.vendor_portal_submit_invoice(...) */
  function submitInvoice(input: {
    poId: string;
    invoiceNumber: string;
    invoiceDate: string | null;
    amount: number;
    currency?: string | null;
    filePath: string;
  }): string {
    if (!input.invoiceNumber || !input.invoiceNumber.trim()) deny("invoice_number_required");
    if (input.amount == null || input.amount <= 0) deny("invalid_amount");

    const po = db.purchase_orders.find((p) => p.id === input.poId);
    if (!po) deny("po_not_found");

    const seat = assertAccess(po.vendor_id);
    if (!seat.exposure.invoices) deny("invoices_not_exposed");

    const prefix = `${po.company_id}/vendor-invoices/${po.vendor_id}/${po.id}/`;
    if (!input.filePath || !input.filePath.startsWith(prefix)) deny("invalid_file_path");

    const row: InvoiceFixture = {
      id: nextId("match"),
      company_id: po.company_id,
      po_id: po.id,
      vendor_invoice_number: input.invoiceNumber.trim(),
      invoice_date: input.invoiceDate,
      invoice_amount: input.amount,
      invoice_currency_code: input.currency ?? po.currency_code,
      invoice_file_path: input.filePath,
      status: "pending",
      created_by: authUid,
    };
    db.three_way_matches.push(row);

    writeEvent(
      po.vendor_id,
      "vendor_portal.invoice_submitted",
      {
        po_id: po.id,
        po_number: po.po_number,
        match_id: row.id,
        amount: input.amount,
        currency: input.currency,
      },
      po.company_id,
    );
    notifyProcurement(po.company_id, {
      type: "vendor_portal.invoice_submitted",
      title: `Vendor invoice ${row.vendor_invoice_number} uploaded for ${po.po_number}`,
      body: `Amount ${input.amount} ${row.invoice_currency_code} — queued for 3-way match`,
      link: "/procurement/matching",
    });
    audit("vendor_portal.invoice_submitted", "three_way_matches", row.id, {
      po_id: po.id,
      vendor_id: po.vendor_id,
      amount: input.amount,
    });
    return row.id;
  }

  /**
   * Mirror of the `submitVendorInvoice` server fn: file validation + storage
   * scan happen before the RPC ever runs.
   */
  async function submitInvoiceViaServerFn(input: {
    poId: string;
    invoiceNumber: string;
    invoiceDate?: string | null;
    amount: number;
    currency?: string | null;
    filePath: string;
    file: { size: number; type: string };
  }): Promise<string> {
    const bad = validateUploadFile(input.file, [VENDOR_INVOICE_MIME]);
    if (bad) deny(bad);
    const scan = await scanVendorUpload({
      path: input.filePath,
      size: input.file.size,
      mimeType: input.file.type,
    });
    if (!scan.clean) deny("quarantined");
    return submitInvoice({
      poId: input.poId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate ?? null,
      amount: input.amount,
      currency: input.currency ?? null,
      filePath: input.filePath,
    });
  }

  /** public.vendor_portal_get_pos(p_vendor_id) — vendor + company scoped. */
  function getPos(vendorId: string): PoFixture[] {
    const seat = assertAccess(vendorId);
    if (!seat.exposure.pos) deny("vendor_portal_pos_not_exposed");
    return db.purchase_orders.filter(
      (p) =>
        p.vendor_id === vendorId &&
        p.company_id === seat.company_id &&
        ["issued", "partially_received", "received", "closed"].includes(p.status),
    );
  }

  /** Procurement-only confirm/counter-propose (server fn, role gated). */
  function confirmEta(
    logId: string,
    caller: { roles: readonly string[]; companyId: string },
    patch: { eta_confirmed?: boolean; current_eta?: string; notes?: string },
  ): void {
    const allowed = ["procurement_admin", "procurement_officer", "company_admin"];
    if (!caller.roles.some((r) => allowed.includes(r))) deny("forbidden_role");
    const log = db.expediting_logs.find((e) => e.id === logId);
    if (!log) deny("not_found");
    if (log.company_id !== caller.companyId) deny("forbidden_role");
    Object.assign(log, patch);
  }

  return {
    db,
    now,
    rpc: {
      assertAccess,
      writeEvent,
      acknowledgePo,
      proposeDelivery,
      submitInvoice,
      getPos,
    },
    serverFn: { submitInvoiceViaServerFn, confirmEta },
  };
}

export type PortalHarness = ReturnType<typeof createPortalHarness>;
