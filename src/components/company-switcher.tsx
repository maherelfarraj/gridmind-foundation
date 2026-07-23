import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface Company {
  id: string;
  name: string;
}

// Stub companies; Batch 03 replaces this with the caller's real memberships.
const STUB_COMPANIES: Company[] = [
  { id: "acme-solar", name: "Acme Solar Group" },
  { id: "brightgrid", name: "BrightGrid EPC" },
  { id: "helios-wind", name: "Helios Wind Partners" },
];

const STORAGE_KEY = "gridmind:active-company";

interface ActiveCompanyContextValue {
  companies: Company[];
  activeCompanyId: string;
  activeCompany: Company;
  setActiveCompanyId: (id: string) => void;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | null>(null);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const [activeCompanyId, setActiveCompanyIdState] = useState<string>(STUB_COMPANIES[0].id);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && STUB_COMPANIES.some((c) => c.id === stored)) {
        setActiveCompanyIdState(stored);
      }
    } catch {
      // ignore storage access failures
    }
  }, []);

  const setActiveCompanyId = useCallback((id: string) => {
    setActiveCompanyIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<ActiveCompanyContextValue>(() => {
    const active =
      STUB_COMPANIES.find((c) => c.id === activeCompanyId) ?? STUB_COMPANIES[0];
    return {
      companies: STUB_COMPANIES,
      activeCompanyId: active.id,
      activeCompany: active,
      setActiveCompanyId,
    };
  }, [activeCompanyId, setActiveCompanyId]);

  return (
    <ActiveCompanyContext.Provider value={value}>
      {children}
    </ActiveCompanyContext.Provider>
  );
}

export function useActiveCompany(): ActiveCompanyContextValue {
  const ctx = useContext(ActiveCompanyContext);
  if (!ctx) {
    throw new Error("useActiveCompany must be used within an ActiveCompanyProvider");
  }
  return ctx;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function CompanySwitcher() {
  const { companies, activeCompany, activeCompanyId, setActiveCompanyId } = useActiveCompany();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2 text-sm font-medium text-foreground"
          aria-label={`Active company: ${activeCompany.name}`}
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
              {initialsOf(activeCompany.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[10rem] truncate sm:inline">{activeCompany.name}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Switch company
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => {
          const isActive = company.id === activeCompanyId;
          return (
            <DropdownMenuItem
              key={company.id}
              onSelect={() => setActiveCompanyId(company.id)}
              className="gap-2"
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-muted text-[10px] font-semibold text-foreground">
                  {initialsOf(company.name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{company.name}</span>
              <Check
                className={cn(
                  "h-4 w-4 text-primary",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
