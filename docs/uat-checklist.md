# GridMind EPC — Persona-Based UAT Checklist

Run this checklist before go-live and after any major release affecting the workflows below. Each
persona should be tested with a real account scoped to a non-production or sandboxed company, not the
seeded demo tenant (see `docs/launch-checklist.md` §4 for demo cleanup requirements).

For each item, record Pass/Fail, tester name, and date. A persona is not signed off until all its
flows pass.

---

## EPC Admin

- [ ] Create a new company/tenant and invite the first user
- [ ] Configure company-wide settings (branding, roles, permissions)
- [ ] Invite and deactivate users; confirm expired invites cannot be accepted
- [ ] Review `/admin/health`, `/admin/performance`, and `/admin/ops-alerts` dashboards
- [ ] Rotate/revoke an API key and confirm the old key is immediately rejected
- [ ] Export an audit log report for a date range
- [ ] Confirm role-based access restricts a non-admin from admin-only pages

## Project Manager

- [ ] Create a new project via the project wizard end-to-end
- [ ] Advance a project through a phase gate and confirm required approvals are enforced
- [ ] Assign tasks/work orders to field engineers
- [ ] Review project schedule and Gantt/timeline view for accuracy
- [ ] Approve or reject a change order
- [ ] Generate a status report/proposal PDF for a project
- [ ] View project-level cron/automation activity (e.g. scheduled reports)

## Procurement Officer

- [ ] Create a purchase order (PO) and route it for approval
- [ ] Approve a PO and confirm it becomes visible to the vendor portal
- [ ] Manage vendor records (create, update, deactivate a vendor)
- [ ] Track PO delivery status and receive goods against a PO
- [ ] Handle a change to a PO (quantity/price amendment) with correct audit trail
- [ ] Reconcile a vendor invoice against a PO
- [ ] Export procurement activity for a given project/date range

## Finance Controller

- [ ] Create and approve a budget for a project
- [ ] Generate and send a client invoice or pay application
- [ ] Record a debit note and confirm it reflects correctly in cash flow
- [ ] Review a budget-overrun alert and confirm it appears on `/admin/ops-alerts`
- [ ] Reconcile cash flow against invoices and POs for a project
- [ ] Confirm 7-year retention policy is applied to financial records (spot check per `docs/launch-checklist.md` §3)
- [ ] Export a finance report for audit purposes

## Field Engineer

- [ ] Log in from a mobile device and view assigned work orders
- [ ] Update work order status (in progress, blocked, complete) from the field
- [ ] Submit a QA/QC inspection or checklist from a mobile session
- [ ] Upload photos/attachments to a work order or inspection
- [ ] View SCADA/telemetry data for an assigned site (if applicable)
- [ ] Confirm offline/poor-connectivity behavior does not lose submitted data (see `docs/p186-mobile-acceptance.md`)

## Vendor Portal User

- [ ] Log in via vendor-specific portal access and view assigned POs
- [ ] Acknowledge/accept a PO
- [ ] Submit a delivery confirmation or invoice against a PO
- [ ] Upload required compliance documents (insurance, certifications)
- [ ] Confirm the vendor cannot see other vendors' or the client's data
- [ ] Receive and respond to a change-order notification

## Client Portal User

- [ ] Log in via client-specific portal access and view project status
- [ ] View and download a generated proposal or status report PDF
- [ ] Approve or comment on a pending client-facing approval (e.g. change order, milestone sign-off)
- [ ] View invoice/pay application status
- [ ] Confirm the client cannot see internal-only data (internal costs, vendor pricing, other clients)
- [ ] Submit a support/inquiry request and confirm it routes correctly
