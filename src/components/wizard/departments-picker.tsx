// P-035 — Departments picker (wizard step 3).
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DEPARTMENT_LABELS,
  PROJECT_DEPARTMENTS,
  type ProjectDepartment,
} from "@/lib/schemas/project-wizard";

type Props = {
  value: ProjectDepartment[];
  onChange: (next: ProjectDepartment[]) => void;
};

export function DepartmentsPicker({ value, onChange }: Props) {
  const toggle = (d: ProjectDepartment, checked: boolean) => {
    const set = new Set(value);
    if (checked) set.add(d);
    else set.delete(d);
    onChange(PROJECT_DEPARTMENTS.filter((x) => set.has(x)));
  };
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {PROJECT_DEPARTMENTS.map((d) => {
        const id = `dept-${d}`;
        const checked = value.includes(d);
        return (
          <label
            key={d}
            htmlFor={id}
            className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-sm text-foreground"
          >
            <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggle(d, Boolean(v))} />
            <Label htmlFor={id} className="cursor-pointer">
              {DEPARTMENT_LABELS[d]}
            </Label>
          </label>
        );
      })}
    </div>
  );
}
