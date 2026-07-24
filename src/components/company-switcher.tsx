import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

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
import { listMyCompanies } from "@/lib/user-roles.functions";

export interface Company {
  id: string;
  name: string;
}

const STORAGE_KEY = "gridmind:active-company";

interface ActiveCompanyContextValue {
  companies: Company[];
  activeCompanyId: string | null;
  activeCompany: Company | null;
  setActiveCompanyId: (id: string) => void;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | null>(null);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const { data: companies = [] } = useQuery({
    queryKey: ["my-companies"],
    queryFn: () => listMyCompanies({ data: {} }),
    staleTime: 60_000,
  });

  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);

  // Hydrate from storage once companies load; drop stale (non-UUID / unknown) values.
  useEffect(() => {
    if (companies.length === 0) return;
    let next: string | null = null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && companies.some((c) => c.id === stored)) next = stored;
    } catch {
      // ignore
    }
    if (!next) next = companies[0]!.id;
    setActiveCompanyIdState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, [companies]);

  const setActiveCompanyId = useCallback((id: string) => {
    setActiveCompanyIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<ActiveCompanyContextValue>(() => {
    const active = companies.find((c) => c.id === activeCompanyId) ?? null;
    return {
      companies,
      activeCompanyId: active?.id ?? null,
      activeCompany: active,
      setActiveCompanyId,
    };
  }, [companies, activeCompanyId, setActiveCompanyId]);

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

  if (!activeCompany) return null;

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
