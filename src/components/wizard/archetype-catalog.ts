// P-033 — Archetype catalog for the project wizard step 1.
// Labels are the sales-facing strings; do not edit without cross-checking
// the ticket. "C&I Rooftop" uses a literal ampersand; "Green H₂" uses the
// subscript-two character (\u2082).
import {
  BatteryCharging,
  Building2,
  FlaskConical,
  Sun,
  SunSnow,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { ProjectArchetype } from "@/lib/wizard-draft";

export type ArchetypeEntry = {
  key: ProjectArchetype;
  label: string;
  icon: LucideIcon;
  capacityHint: string;
  description: string;
  enterpriseOnly?: boolean;
};

export const ARCHETYPES: readonly ArchetypeEntry[] = [
  {
    key: "utility_pv",
    label: "Utility PV",
    icon: Sun,
    capacityHint: "MW",
    description: "Grid-scale ground-mount solar farms.",
  },
  {
    key: "standalone_bess",
    label: "Standalone BESS",
    icon: BatteryCharging,
    capacityHint: "MW + MWh",
    description: "Utility battery storage for grid services and arbitrage.",
  },
  {
    key: "c_and_i_rooftop",
    label: "C&I Rooftop",
    icon: Building2,
    capacityHint: "MW",
    description: "Commercial and industrial rooftop PV installations.",
  },
  {
    key: "hybrid_pv_bess",
    label: "Hybrid PV+BESS",
    icon: SunSnow,
    capacityHint: "MW + MWh",
    description: "Co-located solar and battery storage behind a single POI.",
  },
  {
    key: "onshore_wind",
    label: "Onshore Wind",
    icon: Wind,
    capacityHint: "MW",
    description: "Onshore wind farms with turbine and collection design.",
  },
  {
    key: "green_hydrogen",
    label: "Green H\u2082",
    icon: FlaskConical,
    capacityHint: "MW electrolyser",
    description: "Renewable-powered electrolysis and hydrogen offtake.",
    enterpriseOnly: true,
  },
  {
    key: "transmission_substation",
    label: "Transmission Substation",
    icon: Zap,
    capacityHint: "MW",
    description: "HV/EHV substations, switchyards, and interconnection scopes.",
  },
] as const;
