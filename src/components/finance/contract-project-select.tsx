// P-078 — project link picker for contracts (pay applications require a
// project-scoped contract, so this field must be editable from the UI).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProjectsForRfq } from "@/lib/rfq.functions";

const NONE = "__none__";

export function ContractProjectSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
}) {
  const fn = useServerFn(listProjectsForRfq);
  const projects = useQuery({
    queryKey: ["contract-project-picker"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });

  return (
    <Select
      disabled={disabled}
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger data-testid="contract-project-select">
        <SelectValue placeholder="No project" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No project (portfolio-level)</SelectItem>
        {(projects.data ?? []).map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
