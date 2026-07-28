// Shared navigation map — single source of truth for the AppSidebar and the
// permission simulator, so they can't drift.
//
// P-SIDEBAR: navigation is now expressed as collapsible GROUPS. Items keep
// their module/role gating. Project-scoped destinations use a `:projectId`
// placeholder and are only rendered when a project is in scope.
import {
  BellRing,
  Landmark,
  Leaf,
  Library,
  Activity,
  AlertTriangle,
  Atom,
  BadgeCheck,
  BarChart3,
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  Clock,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Cpu,
  Database,
  Eye,
  FileBarChart,
  FileDown,
  FileSignature,
  FileStack,
  FileText,
  Flag,
  Gauge,
  GitCompare,
  GraduationCap,
  Grid3x3,
  HardHat,
  Handshake,
  Home,
  GitPullRequestArrow,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  MailPlus,
  Map as MapIcon,
  Mountain,
  Package,
  PanelsTopLeft,
  PencilRuler,
  Radio,
  Receipt,
  Scale,
  Settings2,
  Shapes,
  Shield,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Truck,
  UserCircle,
  Users,
  Wrench,
  Workflow,
  Zap,
  type LucideIcon,
  Wallet,
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
  /** Uses a `:projectId` placeholder — only rendered when a project is in scope. */
  projectScoped?: boolean;
}

export type BadgeKey = "approvals" | "alarms" | "punch";

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Rendered as a single top-level link instead of a collapsible group. */
  standalone?: boolean;
  /** Badge rollup bubbled onto the group header. */
  badgeKey?: BadgeKey;
}

/** Back-compat shape used by the permissions simulator. */
export interface NavSection {
  label: string;
  items: NavItem[];
}

const P = (path: string) => `/projects/:projectId${path}`;

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "home",
    label: "Home",
    icon: Home,
    standalone: true,
    items: [
      {
        moduleKey: "admin",
        label: "Dashboard",
        url: "/dashboard",
        icon: LayoutDashboard,
        alwaysVisible: true,
      },
      {
        moduleKey: "admin",
        label: "Portfolio",
        url: "/portfolio",
        icon: Library,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
    ],
  },
  {
    key: "develop",
    label: "Develop & Sell",
    icon: Handshake,
    items: [
      { moduleKey: "crm", label: "CRM Pipeline", url: "/crm/pipeline", icon: Handshake },
      { moduleKey: "crm", label: "Proposals", url: "/proposals", icon: FileText },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    icon: PencilRuler,
    items: [
      { moduleKey: "engineering", label: "Projects", url: "/projects", icon: Boxes },
      {
        moduleKey: "engineering",
        label: "PV equipment library",
        url: "/engineering/pv-library",
        icon: PanelsTopLeft,
      },
      {
        moduleKey: "engineering",
        label: "Drawings",
        url: P("/engineering/drawings"),
        icon: PencilRuler,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "SLD gallery",
        url: P("/engineering/sld"),
        icon: Shapes,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "PV site",
        url: P("/engineering/pv-site"),
        icon: MapIcon,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "PV layout",
        url: P("/engineering/pv-layout"),
        icon: Grid3x3,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "PV simulation",
        url: P("/engineering/pv-simulation"),
        icon: Sun,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Layout optimization",
        url: P("/engineering/layout-optimization"),
        icon: Sigma,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Studies (EA)",
        url: P("/engineering/studies"),
        icon: Zap,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Grid code",
        url: P("/engineering/grid-code"),
        icon: ShieldCheck,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Terrain",
        url: P("/engineering/terrain"),
        icon: Mountain,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Civil features",
        url: P("/engineering/civil-features"),
        icon: MapIcon,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Yield",
        url: P("/engineering/yield"),
        icon: TrendingUp,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "BOM",
        url: P("/engineering/bom"),
        icon: Boxes,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "RFIs",
        url: P("/engineering/rfis"),
        icon: MailPlus,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "Reviews",
        url: P("/engineering/reviews"),
        icon: Eye,
        projectScoped: true,
      },
      {
        moduleKey: "engineering",
        label: "IFC releases",
        url: P("/engineering/ifc-release"),
        icon: FileStack,
        projectScoped: true,
      },
    ],
  },
  {
    key: "procurement",
    label: "Procurement",
    icon: Truck,
    items: [
      { moduleKey: "procurement", label: "Vendors", url: "/procurement/vendors", icon: Truck },
      { moduleKey: "procurement", label: "RFQs", url: "/procurement/rfqs", icon: MailPlus },
      {
        moduleKey: "procurement",
        label: "Purchase orders",
        url: "/procurement/pos",
        icon: Receipt,
      },
      {
        moduleKey: "procurement",
        label: "Goods receipts",
        url: "/procurement/receipts",
        icon: ClipboardCheck,
      },
      {
        moduleKey: "procurement",
        label: "Receiving",
        url: "/procurement/receiving",
        icon: ClipboardCheck,
      },

      {
        moduleKey: "procurement",
        label: "Invoice matching",
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
    ],
  },
  {
    key: "planning",
    label: "Planning & Budget",
    icon: CalendarRange,
    items: [
      {
        moduleKey: "planning_budget",
        label: "WBS",
        url: P("/planning/wbs"),
        icon: Workflow,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Schedule",
        url: P("/planning/schedule"),
        icon: CalendarRange,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Risks",
        url: P("/planning/risks"),
        icon: AlertTriangle,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Budget",
        url: P("/finance/budget"),
        icon: Coins,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "EVM",
        url: P("/finance/evm"),
        icon: BarChart3,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Cash flow",
        url: P("/finance/cash-flow"),
        icon: TrendingUp,
        projectScoped: true,
      },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: Coins,
    items: [
      {
        moduleKey: "planning_budget",
        label: "Cockpit",
        url: "/finance",
        icon: Coins,
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
        label: "Payments",
        url: "/finance/payments",
        icon: Receipt,
      },

      {
        moduleKey: "planning_budget",
        label: "Bank reconciliation",
        url: "/finance/reconciliation",
        icon: Landmark,
      },
      {
        moduleKey: "planning_budget",
        label: "Receivables",
        url: "/finance/receivables",
        icon: Wallet,
      },
      {
        moduleKey: "planning_budget",
        label: "Finance alerts",
        url: "/finance/alerts",
        icon: BellRing,
      },
      {
        moduleKey: "planning_budget",
        label: "Estimating",
        url: "/estimating",
        icon: Calculator,
      },
      {
        moduleKey: "planning_budget",
        label: "Rate library",
        url: "/estimating/rates",
        icon: Library,
      },
      {
        moduleKey: "planning_budget",
        label: "Bonds & guarantees",
        url: "/finance/bonds",
        icon: ShieldCheck,
      },
      {
        moduleKey: "planning_budget",
        label: "Period close",
        url: "/finance/periods",
        icon: CalendarClock,
      },

      {
        moduleKey: "planning_budget",
        label: "Revenue recognition",
        url: "/finance/revenue-recognition",
        icon: Scale,
      },
      {
        moduleKey: "planning_budget",
        label: "Debit notes",
        url: "/finance/debit-notes",
        icon: Scale,
      },
      {
        moduleKey: "planning_budget",
        label: "Pay applications",
        url: P("/finance/pay-applications"),
        icon: FileBarChart,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Change orders",
        url: P("/finance/change-orders"),
        icon: GitCompare,
        projectScoped: true,
      },
      {
        moduleKey: "planning_budget",
        label: "Project finance",
        url: P("/finance/project-finance"),
        icon: Coins,
        projectScoped: true,
      },
    ],
  },
  {
    key: "construction",
    label: "Construction controls",
    icon: HardHat,
    items: [
      {
        moduleKey: "field_qaqc",
        label: "Work packages",
        url: "/construction/cwp",
        icon: Boxes,
      },
      {
        moduleKey: "field_qaqc",
        label: "Look-ahead",
        url: "/construction/look-ahead",
        icon: CalendarRange,
      },
      {
        moduleKey: "field_qaqc",
        label: "Baseline compare",
        url: "/construction/baseline-compare",
        icon: GitCompare,
      },
      {
        moduleKey: "field_qaqc",
        label: "Productivity",
        url: "/construction/productivity",
        icon: BarChart3,
      },
    ],
  },
  {
    key: "field",
    label: "Field, HSE & QA/QC",
    icon: HardHat,
    items: [
      {
        moduleKey: "field_qaqc",
        label: "Mobilization",
        url: "/field/mobilization",
        icon: ClipboardCheck,
      },
      { moduleKey: "field_qaqc", label: "Daily reports", url: "/field/dpr", icon: ClipboardList },
      {
        moduleKey: "field_qaqc",
        label: "Discipline board",
        url: "/field/discipline-board",
        icon: SlidersHorizontal,
      },
      {
        moduleKey: "field_qaqc",
        label: "Work fronts",
        url: "/field/work-fronts",
        icon: HardHat,
      },
      {
        moduleKey: "field_qaqc",
        label: "Deliveries",
        url: "/field/deliveries",
        icon: Truck,
      },
      { moduleKey: "field_qaqc", label: "Timesheets", url: "/timesheets", icon: Clock },
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
        label: "Risk assessments",
        url: "/hse/risk-assessments",
        icon: Shield,
      },
      { moduleKey: "field_qaqc", label: "JSAs", url: "/hse/jsa", icon: ClipboardCheck },
      {
        moduleKey: "field_qaqc",
        label: "Safety observations",
        url: "/hse/observations",
        icon: AlertTriangle,
      },
      {
        moduleKey: "field_qaqc",
        label: "Competency",
        url: "/hse/competency",
        icon: GraduationCap,
      },
      {
        moduleKey: "field_qaqc",
        label: "Emergency response",
        url: "/hse/emergency",
        icon: AlertTriangle,
      },
      {
        moduleKey: "field_qaqc",
        label: "Environmental",
        url: "/hse/environmental",
        icon: Shield,
      },
      { moduleKey: "field_qaqc", label: "Waste tracking", url: "/hse/waste", icon: Truck },
      { moduleKey: "field_qaqc", label: "ESG dashboard", url: "/esg", icon: Leaf },
      { moduleKey: "field_qaqc", label: "ESG activity", url: "/esg/activity", icon: Leaf },

      { moduleKey: "field_qaqc", label: "HSE audits", url: "/hse/audits", icon: ClipboardCheck },
      {
        moduleKey: "field_qaqc",
        label: "QA/QC inspections",
        url: "/qaqc/inspections",
        icon: ClipboardCheck,
      },
      { moduleKey: "field_qaqc", label: "QA/QC heatmap", url: "/qaqc/heatmap", icon: Grid3x3 },
      { moduleKey: "field_qaqc", label: "Punch list", url: "/qaqc/punch", icon: Flag },
      { moduleKey: "field_qaqc", label: "NCRs", url: "/qaqc/ncrs", icon: AlertTriangle },
      { moduleKey: "field_qaqc", label: "ITPs", url: "/quality/itp", icon: ClipboardCheck },
      { moduleKey: "field_qaqc", label: "MIRs", url: "/quality/mir", icon: ClipboardList },
      { moduleKey: "field_qaqc", label: "FAT / SAT", url: "/quality/fat-sat", icon: BadgeCheck },
      {
        moduleKey: "field_qaqc",
        label: "Test records",
        url: "/quality/test-records",
        icon: Gauge,
      },
      { moduleKey: "field_qaqc", label: "Dossiers", url: "/quality/dossiers", icon: FileDown },
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
    ],
  },
  {
    key: "commissioning",
    label: "Commissioning",
    icon: BadgeCheck,
    badgeKey: "punch",
    items: [
      {
        moduleKey: "commissioning",
        label: "Test board",
        url: P("/commissioning"),
        icon: ClipboardCheck,
        projectScoped: true,
      },
      {
        moduleKey: "commissioning",
        label: "Performance",
        url: P("/commissioning/performance"),
        icon: Gauge,
        projectScoped: true,
      },
      {
        moduleKey: "commissioning",
        label: "Punch closure",
        url: P("/commissioning/punch"),
        icon: Flag,
        projectScoped: true,
      },
      {
        moduleKey: "commissioning",
        label: "Certificates",
        url: P("/commissioning/certificates"),
        icon: BadgeCheck,
        projectScoped: true,
      },
      {
        moduleKey: "commissioning",
        label: "Turnover",
        url: P("/commissioning/turnover"),
        icon: FileStack,
        projectScoped: true,
      },
      {
        moduleKey: "commissioning",
        label: "KPIs",
        url: P("/commissioning/kpis"),
        icon: BarChart3,
        projectScoped: true,
      },
    ],
  },
  {
    key: "om",
    label: "O&M & SCADA",
    icon: Wrench,
    badgeKey: "alarms",
    items: [
      { moduleKey: "om_scada", label: "SCADA dashboard", url: "/om/scada", icon: Gauge },
      {
        moduleKey: "om_scada",
        label: "Connectors",
        url: "/om/scada/connectors",
        icon: Radio,
      },
      {
        moduleKey: "om_scada",
        label: "Tag mappings",
        url: "/om/scada/mappings",
        icon: SlidersHorizontal,
      },
      { moduleKey: "om_scada", label: "CSV import", url: "/om/scada/import", icon: Database },
      {
        moduleKey: "om_scada",
        label: "Ingestion health",
        url: "/om/scada/ingestion-health",
        icon: Activity,
      },
      { moduleKey: "om_scada", label: "Alarms", url: "/om/scada/alarms", icon: AlertTriangle },
      {
        moduleKey: "om_scada",
        label: "Alarm console",
        url: "/om/scada/alarm-console",
        icon: Cpu,
      },
      {
        moduleKey: "om_scada",
        label: "Alarm rules",
        url: "/om/scada/alarm-rules",
        icon: SlidersHorizontal,
      },
      { moduleKey: "om_scada", label: "Events", url: "/om/scada/events", icon: ClipboardList },
      { moduleKey: "om_scada", label: "Trends", url: "/om/scada/trends", icon: TrendingUp },
      { moduleKey: "om_scada", label: "Analytics", url: "/om/scada/analytics", icon: BarChart3 },
      {
        moduleKey: "om_scada",
        label: "Action rules",
        url: "/om/scada/action-rules",
        icon: Workflow,
      },
      { moduleKey: "om_scada", label: "Work orders", url: "/om/work-orders", icon: Wrench },
      {
        moduleKey: "om_scada",
        label: "Maintenance plans",
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
      { moduleKey: "om_scada", label: "O&M reports", url: "/om/reports", icon: FileDown },
    ],
  },
  {
    key: "portals",
    label: "Client & Partners",
    icon: Users,
    items: [
      {
        moduleKey: "portals",
        label: "Portal members",
        url: "/settings/portal-members",
        icon: Users,
      },
      { moduleKey: "portals", label: "Share links", url: "/settings/share-links", icon: Link2 },
    ],
  },
  {
    key: "green_h2",
    label: "Green H₂",
    icon: Atom,
    items: [
      { moduleKey: "green_hydrogen", label: "Green H₂ projects", url: "/projects", icon: Atom },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    icon: Settings2,
    badgeKey: "approvals",
    items: [
      {
        moduleKey: "admin",
        label: "Approvals",
        url: "/approvals",
        icon: Inbox,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
      {
        moduleKey: "admin",
        label: "Change Control",
        url: "/changes",
        icon: GitPullRequestArrow,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
      { moduleKey: "admin", label: "Users", url: "/settings/users", icon: MailPlus },
      { moduleKey: "admin", label: "Departments", url: "/settings/departments", icon: Building2 },
      {
        moduleKey: "admin",
        label: "Tenants",
        url: "/admin/tenants",
        icon: Shield,
        requiresSuperAdmin: true,
      },
      {
        moduleKey: "admin",
        label: "Module access",
        url: "/settings/modules",
        icon: SlidersHorizontal,
      },
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
        moduleKey: "admin",
        label: "Procurement settings",
        url: "/settings/procurement",
        icon: Receipt,
      },
      {
        moduleKey: "engineering",
        label: "SLD symbol registry",
        url: "/settings/sld-symbols",
        icon: Shapes,
      },
      { moduleKey: "admin", label: "Portal events", url: "/settings/portal-audit", icon: Eye },
      {
        moduleKey: "admin",
        label: "Permissions simulator",
        url: "/settings/permissions-simulator",
        icon: Eye,
      },
      { moduleKey: "admin", label: "Health", url: "/admin/health", icon: Activity },
      { moduleKey: "admin", label: "API keys", url: "/settings/api-keys", icon: KeyRound },
      { moduleKey: "admin", label: "Webhooks", url: "/settings/webhooks", icon: Radio },
      {
        moduleKey: "admin",
        label: "API docs",
        url: "/docs/api",
        icon: FileText,
        alwaysVisible: true,
        hideFromExternalViewers: true,
      },
      {
        moduleKey: "admin",
        label: "Profile",
        url: "/settings/profile",
        icon: UserCircle,
        alwaysVisible: true,
      },
      { moduleKey: "admin", label: "Company", url: "/settings/company", icon: Settings2 },
    ],
  },
];

/** Back-compat: flat section list consumed by the permissions simulator. */
export const NAV_SECTIONS: NavSection[] = NAV_GROUPS.map((g) => ({
  label: g.label,
  items: g.items,
}));
