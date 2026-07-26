// Shared navigation map — single source of truth for both the AppSidebar and
// the permission simulator, so they can't drift. Forward-looking routes are
// fine here; they mirror the nav map as feature batches land.
import {
  Radio,
  AlertTriangle,
  Atom,
  Building2,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  Eye,
  HardHat,
  Handshake,
  FileDown,
  BookOpen,
  Inbox,
  KeyRound,
  LifeBuoy,
  MailPlus,
  Package,
  PencilRuler,
  Receipt,
  FileSignature,
  Gauge,
  GraduationCap,
  Scale,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
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
  /** When true, the item is shown to every authenticated user regardless of module/plan gating. */
  alwaysVisible?: boolean;
  /** When true, external viewer roles (client/investor/lender viewer) cannot see this item. */
  hideFromExternalViewers?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      {
        moduleKey: "admin",
        label: "Approvals",
        url: "/approvals",
        icon: Inbox,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
    ],
  },
  {
    label: "Lifecycle",
    items: [
      { moduleKey: "crm", label: "Develop & Sell (CRM)", url: "/crm/pipeline", icon: Handshake },
      { moduleKey: "engineering", label: "Engineering", url: "/projects", icon: PencilRuler },
      { moduleKey: "procurement", label: "Procurement", url: "/procurement/vendors", icon: Truck },
      { moduleKey: "procurement", label: "RFQs", url: "/procurement/rfqs", icon: MailPlus },
      {
        moduleKey: "procurement",
        label: "Purchase Orders",
        url: "/procurement/pos",
        icon: Receipt,
      },
      {
        moduleKey: "procurement",
        label: "Goods Receipts",
        url: "/procurement/receipts",
        icon: ClipboardCheck,
      },
      {
        moduleKey: "procurement",
        label: "Invoice Matching",
        url: "/procurement/matches",
        icon: Scale,
      },
      {
        moduleKey: "procurement",
        label: "Expediting",
        url: "/procurement/expediting",
        icon: Truck,
      },
      {
        moduleKey: "procurement",
        label: "Scorecards",
        url: "/procurement/scorecards",
        icon: Gauge,
      },
      {
        moduleKey: "procurement",
        label: "Price alerts",
        url: "/procurement/price-alerts",
        icon: TrendingUp,
      },
      {
        moduleKey: "procurement",
        label: "Spare parts",
        url: "/procurement/spare-parts",
        icon: Package,
      },

      {
        moduleKey: "planning_budget",
        label: "Planning & Budget",
        url: "/projects",
        icon: CalendarRange,
      },
      {
        moduleKey: "planning_budget",
        label: "Contracts",
        url: "/finance/contracts",
        icon: FileSignature,
      },
      { moduleKey: "planning_budget", label: "Invoices", url: "/finance/invoices", icon: Receipt },
      {
        moduleKey: "planning_budget",
        label: "Debit notes",
        url: "/finance/debit-notes",
        icon: Scale,
      },
      { moduleKey: "field_qaqc", label: "Field, HSE & QA/QC", url: "/field/dpr", icon: HardHat },
      {
        moduleKey: "field_qaqc",
        label: "Mobilization",
        url: "/field/mobilization",
        icon: ClipboardCheck,
      },
      {
        moduleKey: "field_qaqc",
        label: "Discipline board",
        url: "/field/discipline-board",
        icon: SlidersHorizontal,
      },
      { moduleKey: "field_qaqc", label: "Daily reports", url: "/field/dpr", icon: ClipboardCheck },
      { moduleKey: "field_qaqc", label: "Weekly report", url: "/field/reports", icon: FileDown },
      { moduleKey: "field_qaqc", label: "HSE", url: "/hse", icon: Shield },
      {
        moduleKey: "field_qaqc",
        label: "HSE incidents",
        url: "/hse/incidents",
        icon: AlertTriangle,
      },
      {
        moduleKey: "field_qaqc",
        label: "HSE inspections",
        url: "/hse/inspections",
        icon: ClipboardCheck,
      },
      { moduleKey: "field_qaqc", label: "HSE training", url: "/hse/training", icon: GraduationCap },
      {
        moduleKey: "field_qaqc",
        label: "QA/QC inspections",
        url: "/qaqc/inspections",
        icon: ClipboardCheck,
      },
      {
        moduleKey: "field_qaqc",
        label: "QA/QC heatmap",
        url: "/qaqc/heatmap",
        icon: SlidersHorizontal,
      },
      { moduleKey: "field_qaqc", label: "Punch list", url: "/qaqc/punch", icon: ClipboardCheck },
      { moduleKey: "field_qaqc", label: "NCRs", url: "/qaqc/ncrs", icon: AlertTriangle },
      {
        moduleKey: "field_qaqc",
        label: "Submittals",
        url: "/field/submittals",
        icon: FileSignature,
      },
      {
        moduleKey: "field_qaqc",
        label: "Transmittals",
        url: "/field/transmittals",
        icon: MailPlus,
      },
      {
        moduleKey: "commissioning",
        label: "Commission & Turnover",
        url: "/projects",
        icon: ClipboardCheck,
      },
      { moduleKey: "om_scada", label: "O&M & SCADA", url: "/om/scada", icon: Wrench },
      { moduleKey: "om_scada", label: "SCADA dashboard", url: "/om/scada", icon: Gauge },
      {
        moduleKey: "om_scada",
        label: "SCADA connectors",
        url: "/om/scada/connectors",
        icon: Radio,
      },
      { moduleKey: "om_scada", label: "Alarms", url: "/om/scada/alarms", icon: AlertTriangle },
      {
        moduleKey: "om_scada",
        label: "Alarm rules",
        url: "/om/scada/alarm-rules",
        icon: SlidersHorizontal,
      },
      { moduleKey: "om_scada", label: "Work orders", url: "/om/work-orders", icon: Wrench },
      {
        moduleKey: "om_scada",
        label: "PM plans",
        url: "/om/maintenance-plans",
        icon: CalendarRange,
      },
      { moduleKey: "om_scada", label: "Warranties", url: "/om/warranties", icon: ShieldCheck },
      {
        moduleKey: "om_scada",
        label: "Service tickets",
        url: "/om/service-tickets",
        icon: LifeBuoy,
      },
      { moduleKey: "om_scada", label: "Monthly reports", url: "/om/reports", icon: FileDown },
      {
        moduleKey: "portals",
        label: "Client & Investor Portals",
        url: "/settings/portal-members",
        icon: Users,
      },
      { moduleKey: "green_hydrogen", label: "Green H₂", url: "/projects", icon: Atom },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        moduleKey: "admin",
        label: "Profile",
        url: "/settings/profile",
        icon: UserCircle,
        alwaysVisible: true,
      },
      { moduleKey: "admin", label: "Company", url: "/settings/company", icon: Settings2 },
      { moduleKey: "admin", label: "Users", url: "/settings/users", icon: MailPlus },
      { moduleKey: "admin", label: "Departments", url: "/settings/departments", icon: Building2 },
      {
        moduleKey: "admin",
        label: "Module access",
        url: "/settings/modules",
        icon: SlidersHorizontal,
      },
      { moduleKey: "admin", label: "Procurement", url: "/settings/procurement", icon: Receipt },
      {
        moduleKey: "admin",
        label: "Approval rules",
        url: "/settings/approval-rules",
        icon: ShieldCheck,
      },
      {
        moduleKey: "admin",
        label: "Scheduled reports",
        url: "/settings/scheduled-reports",
        icon: CalendarClock,
      },
      {
        moduleKey: "engineering",
        label: "SLD symbol registry",
        url: "/settings/sld-symbols",
        icon: Shapes,
      },
      { moduleKey: "admin", label: "API keys", url: "/settings/api-keys", icon: KeyRound },
      { moduleKey: "admin", label: "Webhooks", url: "/settings/webhooks", icon: Radio },
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
  {
    label: "Help & Docs",
    items: [
      {
        moduleKey: "admin",
        label: "API docs",
        url: "/docs/api",
        icon: BookOpen,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
    ],
  },
];
