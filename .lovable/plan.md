Plan: send the first 18 user invites under the @gridmind.captial domain, mapping each to the correct system role using the provided reference, then verify and report back.

## Mapped invites
| Email alias | Job description | System role(s) |
|---|---|---|
| maher.elfarraj@gridmind.captial | Company owner, super administrator, final approver | super_admin, company_admin |
| company.admin@gridmind.captial | Second company administrator / operational backup | company_admin |
| project.manager@gridmind.captial | Project manager | project_admin |
| engineering.manager@gridmind.captial | Head of engineering | engineering_admin |
| procurement.manager@gridmind.captial | Head of procurement | procurement_admin |
| construction.manager@gridmind.captial | Head of construction | construction_admin |
| site.engineer@gridmind.captial | Site engineer | engineer |
| site.foreman@gridmind.captial | Site foreman | foreman |
| hse.manager@gridmind.captial | HSE department head | hse_admin |
| finance.manager@gridmind.captial | Finance head | finance_admin |
| legal.manager@gridmind.captial | Legal head | legal_admin |
| operations.manager@gridmind.captial | O&M department head | om_admin |
| scada.manager@gridmind.captial | SCADA department head | scada_admin |
| billing.admin@gridmind.captial | Billing / subscription admin | billing_admin |
| client.owner@gridmind.captial | Client project owner | client_viewer |
| investor.viewer@gridmind.captial | Investor | investor_viewer |
| lender.viewer@gridmind.captial | Bank / lender | lender_viewer |
| audit.viewer@gridmind.captial | Read-only workflow tester | client_viewer |

## Governance checks applied
- Two active company_admin accounts: maher.elfarraj + company.admin.
- External stakeholders (client, investor, lender, audit viewer) receive only viewer roles.
- All department heads receive their *_admin role.
- No administrative role is assigned based on title alone; each role matches the responsibilities in the description.
- project_admin is scoped to the app’s project assignment logic.

## Implementation steps
1. Create the 18 user rows under the GSI tenant (`companies.id = 1ab0730f-d6fa-4678-b1b7-7f752c80aceb`) via the existing app invite mechanism (`sendInvite` server function / `invites` table + `user_roles` inserts).
2. Assign the mapped roles in `public.user_roles`.
3. Write an `admin.invite_batch` audit log row under GSI with the email list and assigned roles.
4. Verify counts: `SELECT role, COUNT(*) FROM public.user_roles WHERE user_id IN (profiles of GSI users) GROUP BY role` should show the expected distribution.
5. Report per-invite status: accepted/pending, role assigned, and any send errors.

## Verification
- `public.profiles` shows 18 new GSI-associated rows.
- `public.user_roles` shows the mapped roles.
- `public.invites` shows the 18 sent invites with the correct `invited_by` and `company_id`.
- Audit log contains `admin.invite_batch` with the batch metadata.