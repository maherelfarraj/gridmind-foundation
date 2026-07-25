// P-125 — Catalog of platform tables that may be emitted as outbound
// webhook events. Grouped by domain so the /settings/webhooks UI can render
// a per-domain toggle list. The database backs this with the
// `webhook_export_allowlist` table (per-company opt-in).
//
// Adding a table here does NOT auto-enable exports — the company admin must
// still toggle it on. Removing a table here removes it from the UI but does
// not delete existing allowlist rows.

export interface ExportableTable {
  table: string;
  label: string;
}

export interface ExportableDomain {
  key: string;
  label: string;
  tables: ExportableTable[];
}

export const EXPORT_ALLOWLIST_CATALOG: ExportableDomain[] = [
  {
    key: "projects",
    label: "Projects & Programme",
    tables: [
      { table: "projects", label: "Projects" },
      { table: "project_members", label: "Project members" },
      { table: "project_departments", label: "Project departments" },
      { table: "project_phase_gates", label: "Phase gates" },
      { table: "project_intake", label: "Project intake" },
      { table: "project_templates", label: "Project templates" },
      { table: "schedule_tasks", label: "Schedule tasks" },
      { table: "wbs_items", label: "WBS items" },
      { table: "baseline_snapshots", label: "Baseline snapshots" },
      { table: "evm_snapshots", label: "EVM snapshots" },
      { table: "risks", label: "Risks" },
    ],
  },
  {
    key: "crm",
    label: "CRM & Sales",
    tables: [
      { table: "leads", label: "Leads" },
      { table: "opportunities", label: "Opportunities" },
      { table: "proposals", label: "Proposals" },
      { table: "proposal_line_items", label: "Proposal line items" },
      { table: "contacts", label: "Contacts" },
      { table: "tender_events", label: "Tender events" },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    tables: [
      { table: "drawing_register", label: "Drawing register" },
      { table: "drawing_revisions", label: "Drawing revisions" },
      { table: "drawing_review_rounds", label: "Drawing review rounds" },
      { table: "drawing_review_signoffs", label: "Drawing review sign-offs" },
      { table: "ifc_releases", label: "IFC releases" },
      { table: "ifc_release_signoffs", label: "IFC release sign-offs" },
      { table: "submittals", label: "Submittals" },
      { table: "transmittals", label: "Transmittals" },
      { table: "rfis", label: "RFIs" },
      { table: "bom_snapshots", label: "BOM snapshots" },
      { table: "bom_lines", label: "BOM lines" },
      { table: "documents", label: "Documents" },
      { table: "document_markups", label: "Document markups" },
    ],
  },
  {
    key: "procurement",
    label: "Procurement & Supply",
    tables: [
      { table: "vendors", label: "Vendors" },
      { table: "vendor_scorecards", label: "Vendor scorecards" },
      { table: "rfqs", label: "RFQs" },
      { table: "rfq_bids", label: "RFQ bids" },
      { table: "rfq_line_awards", label: "RFQ line awards" },
      { table: "purchase_orders", label: "Purchase orders" },
      { table: "goods_receipts", label: "Goods receipts" },
      { table: "three_way_matches", label: "Three-way matches" },
      { table: "expediting_logs", label: "Expediting logs" },
      { table: "material_price_alerts", label: "Material price alerts" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    tables: [
      { table: "contracts", label: "Contracts" },
      { table: "contract_obligations", label: "Contract obligations" },
      { table: "change_orders", label: "Change orders" },
      { table: "invoices", label: "Invoices" },
      { table: "debit_notes", label: "Debit notes" },
      { table: "pay_applications", label: "Pay applications" },
      { table: "budgets", label: "Budgets" },
      { table: "cash_flows", label: "Cash flows" },
      { table: "bank_facilities", label: "Bank facilities" },
      { table: "cost_codes", label: "Cost codes" },
      { table: "lcoe_scenarios", label: "LCoE scenarios" },
      { table: "ppa_terms", label: "PPA terms" },
      { table: "lender_dd_items", label: "Lender DD items" },
    ],
  },
  {
    key: "approvals",
    label: "Approvals & Governance",
    tables: [
      { table: "approvals", label: "Approvals" },
      { table: "approval_instances", label: "Approval instances" },
      { table: "approval_rules", label: "Approval rules" },
      { table: "approval_chain_steps", label: "Approval chain steps" },
      { table: "audit_logs", label: "Audit logs" },
    ],
  },
  {
    key: "field",
    label: "Field & Construction",
    tables: [
      { table: "construction_daily_reports", label: "Daily reports" },
      { table: "field_observations", label: "Field observations" },
      { table: "manpower_logs", label: "Manpower logs" },
      { table: "weather_delays", label: "Weather delays" },
      { table: "site_photos", label: "Site photos" },
      { table: "mobilization_checklists", label: "Mobilization checklists" },
      { table: "equipment_registry", label: "Equipment registry" },
    ],
  },
  {
    key: "qaqc",
    label: "QA/QC & Commissioning",
    tables: [
      { table: "qaqc_inspections", label: "QA/QC inspections" },
      { table: "qaqc_punch_items", label: "Punch items" },
      { table: "punch_signoffs", label: "Punch sign-offs" },
      { table: "ncrs", label: "NCRs" },
      { table: "commissioning_tests", label: "Commissioning tests" },
      { table: "commissioning_certificates", label: "Commissioning certificates" },
      { table: "performance_tests", label: "Performance tests" },
      { table: "turnover_packages", label: "Turnover packages" },
    ],
  },
  {
    key: "hse",
    label: "HSE",
    tables: [
      { table: "hse_incidents", label: "HSE incidents" },
      { table: "hse_inspections", label: "HSE inspections" },
      { table: "hse_training_records", label: "HSE training records" },
    ],
  },
  {
    key: "om",
    label: "O&M & SCADA",
    tables: [
      { table: "work_orders", label: "Work orders" },
      { table: "preventive_maintenance_plans", label: "PM plans" },
      { table: "service_tickets", label: "Service tickets" },
      { table: "sla_records", label: "SLA records" },
      { table: "spare_parts", label: "Spare parts" },
      { table: "warranty_contracts", label: "Warranty contracts" },
      { table: "warranty_claims", label: "Warranty claims" },
      { table: "om_reports", label: "O&M reports" },
      { table: "scada_assets", label: "SCADA assets" },
      { table: "scada_connectors", label: "SCADA connectors" },
      { table: "scada_alarms", label: "SCADA alarms" },
      { table: "alarm_rules", label: "Alarm rules" },
    ],
  },
  {
    key: "portal",
    label: "Client & Investor Portal",
    tables: [
      { table: "portal_memberships", label: "Portal memberships" },
      { table: "portal_tickets", label: "Portal tickets" },
      { table: "investor_share_links", label: "Investor share links" },
    ],
  },
];

/** Flat set of all catalog table names for O(1) allowlist validation. */
export const EXPORTABLE_TABLE_NAMES: ReadonlySet<string> = new Set(
  EXPORT_ALLOWLIST_CATALOG.flatMap((d) => d.tables.map((t) => t.table)),
);

export function isExportableTable(name: string): boolean {
  return EXPORTABLE_TABLE_NAMES.has(name);
}
