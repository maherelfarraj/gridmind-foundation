// Shared navigation map — single source of truth for both the AppSidebar and
// the permission simulator, so they can't drift. Forward-looking routes are
// fine here; they mirror the nav map as feature batches land.
import {
  Atom,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Eye,
  HardHat,
  Handshake,
  MailPlus,
  PencilRuler,
  Settings2,
  Shield,
  SlidersHorizontal,
  Truck,
  UserCircle,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ModuleKey } from "./permissions";

export interface NavItem {
  moduleKey: ModuleKey;
  label: string;
  url: string;
  icon: LucideIcon;
  requiresSuperAdmin?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Lifecycle",
    items: [
      { moduleKey: "crm", label: "Develop & Sell (CRM)", url: "/crm", icon: Handshake },
      { moduleKey: "engineering", label: "Engineering", url: "/engineering", icon: PencilRuler },
      { moduleKey: "procurement", label: "Procurement", url: "/procurement", icon: Truck },
      { moduleKey: "planning_budget", label: "Planning & Budget", url: "/planning", icon: CalendarRange },
      { moduleKey: "field_qaqc", label: "Field, HSE & QA/QC", url: "/field", icon: HardHat },
      {
        moduleKey: "commissioning",
        label: "Commission & Turnover",
        url: "/commissioning",
        icon: ClipboardCheck,
      },
      { moduleKey: "om_scada", label: "O&M & SCADA", url: "/om", icon: Wrench },
      { moduleKey: "portals", label: "Client & Investor Portals", url: "/partners", icon: Users },
      { moduleKey: "green_hydrogen", label: "Green H₂", url: "/green-h2", icon: Atom },
    ],
  },
  {
    label: "Administration",
    items: [
      { moduleKey: "admin", label: "Profile", url: "/settings/profile", icon: UserCircle },
      { moduleKey: "admin", label: "Company", url: "/settings/company", icon: Settings2 },
      { moduleKey: "admin", label: "Users", url: "/settings/users", icon: MailPlus },
      { moduleKey: "admin", label: "Departments", url: "/settings/departments", icon: Building2 },
      { moduleKey: "admin", label: "Module access", url: "/settings/modules", icon: SlidersHorizontal },
      {
        moduleKey: "admin",
        label: "Permissions simulator",
        url: "/settings/permissions-simulator",
        icon: Eye,
      },
      {
        moduleKey: "admin",
        label: "Tenants",
        url: "/admin/tenants",
        icon: Shield,
        requiresSuperAdmin: true,
      },
    ],
  },
];
