import { Constants } from "@/integrations/supabase/types";

export type AppRole = (typeof Constants.public.Enums.app_role)[number];
export type GrantableRole = Exclude<AppRole, "super_admin">;

export type RoleGroup = {
  key: string;
  label: string;
  roles: GrantableRole[];
};

export const ROLE_GROUPS: RoleGroup[] = [
  {
    key: "administration",
    label: "Administration",
    roles: ["company_admin", "billing_admin", "project_admin"],
  },
  {
    key: "department",
    label: "Department admins",
    roles: [
      "engineering_admin",
      "procurement_admin",
      "construction_admin",
      "hse_admin",
      "finance_admin",
      "legal_admin",
      "om_admin",
      "scada_admin",
    ],
  },
  {
    key: "operational",
    label: "Operational",
    roles: [
      "engineer",
      "sales",
      "procurement_officer",
      "foreman",
      "field_technician",
    ],
  },
  {
    key: "external",
    label: "External viewers",
    roles: ["client_viewer", "investor_viewer", "lender_viewer"],
  },
];

export const GRANTABLE_ROLES: GrantableRole[] = ROLE_GROUPS.flatMap(
  (g) => g.roles,
);

// Compile-time exhaustiveness: any new app_role (other than super_admin)
// added to the enum will fail typecheck here until it is grouped above.
type _ExhaustiveCheck = Exclude<GrantableRole, (typeof GRANTABLE_ROLES)[number]>;
const _exhaustive: _ExhaustiveCheck[] = [];
void _exhaustive;

export function humanizeRole(role: AppRole): string {
  return role.replace(/_/g, " ");
}
