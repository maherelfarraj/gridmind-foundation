// GC-16d — Project-cockpit entry point for governed calendar policy.
//
// Lets a controls/finance user manage the CONTRACT-level override for any
// contract on the project, or fall back to the company default policy view.
// All authorisation and immutability lives server-side.
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { CalendarPolicyAdmin } from "@/components/contracts-claims/calendar-policy-admin";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { contractsListQueryOptions } from "@/lib/contracts.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.calendarPolicy";
const COMPANY = "__company__";

export function ProjectCalendarPolicySection({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { data } = useSuspenseQuery(contractsListQueryOptions({ projectId }));
  const [selected, setSelected] = useState<string>(COMPANY);
  const isContract = selected !== COMPANY;

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-1">
        <Label htmlFor="calendar-policy-scope">{t(`${K}.fields.scope`)}</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="calendar-policy-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={COMPANY}>{t(`${K}.scope.company`)}</SelectItem>
            {data.rows.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {`${t(`${K}.scope.contract`)} — ${c.contract_number ?? c.title}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CalendarPolicyAdmin
        key={selected}
        scope={isContract ? "contract" : "company"}
        projectId={projectId}
        contractId={isContract ? selected : undefined}
      />
    </div>
  );
}
