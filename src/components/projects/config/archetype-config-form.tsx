// P-039 — Archetype config form. One generic component renders the right
// field set for a given config key using shared zod schemas.
import { useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveArchetypeConfig } from "@/lib/projects.functions";
import { archetypeConfigsQueryOptions } from "@/lib/archetype-configs-query";
import {
  CONFIG_DEFAULTS,
  CONFIG_EDIT_ROLES,
  CONFIG_LABELS,
  configSchemas,
  type ArchetypeConfigKey,
} from "@/lib/schemas/archetype-configs";

import { FieldShell } from "./field-shell";
import { KeyValueEditor } from "./key-value-editor";

// Convert DB row (nulls) into form-friendly defaults (empty strings so inputs
// stay controlled; zod preprocess turns them back into undefined on submit).
function toFormValues(
  key: ArchetypeConfigKey,
  row: Record<string, any> | null,
): Record<string, any> {
  const defaults = { ...(CONFIG_DEFAULTS[key] as Record<string, any>) };
  const src = row ?? {};
  const out: Record<string, any> = { ...defaults };
  for (const [k, v] of Object.entries(src)) {
    if (k === "id" || k === "created_at" || k === "updated_at") continue;
    if (k === "company_id" || k === "project_id") continue;
    out[k] = v ?? (typeof defaults[k] === "boolean" ? false : "");
  }
  // JSON array fields
  if (key === "sld") out.voltage_levels = out.voltage_levels ?? [];
  if (key === "cybersecurity") out.zones_conduits = out.zones_conduits ?? [];
  return out;
}

export function ArchetypeConfigForm({
  configKey,
  projectId,
  initial,
  canEdit,
}: {
  configKey: ArchetypeConfigKey;
  projectId: string;
  initial: Record<string, any> | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveArchetypeConfig);

  const defaultValues = useMemo(() => toFormValues(configKey, initial), [configKey, initial]);

  const form = useForm({
    resolver: zodResolver(configSchemas[configKey] as any),
    defaultValues,
    values: defaultValues,
  });

  const mutation = useMutation({
    mutationFn: (values: any) =>
      saveFn({ data: { project_id: projectId, config: configKey, values } }),
    onSuccess: () => {
      toast.success("Configuration saved");
      queryClient.invalidateQueries({
        queryKey: ["archetype-configs", projectId],
      });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  const roleLabels = CONFIG_EDIT_ROLES[configKey].join(", ");

  return (
    <Card className="border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {CONFIG_LABELS[configKey]} configuration
        </h2>
        {!canEdit && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Read only
          </span>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <fieldset disabled={!canEdit || mutation.isPending} className="contents">
          <ConfigFields configKey={configKey} form={form} />
        </fieldset>

        {mutation.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Could not save configuration."}
          </div>
        )}

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            You need one of {roleLabels} to edit this section.
          </p>
        ) : (
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 size={14} aria-hidden className="animate-spin" />}
              Save configuration
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Field renderers per config key
// ---------------------------------------------------------------------------

type F = UseFormReturn<any>;

function ConfigFields({ configKey, form }: { configKey: ArchetypeConfigKey; form: F }) {
  switch (configKey) {
    case "pv":
      return <PvFields form={form} />;
    case "bess":
      return <BessFields form={form} />;
    case "substation":
      return <SubstationFields form={form} />;
    case "sld":
      return <SldFields form={form} />;
    case "scada":
      return <ScadaFields form={form} />;
    case "yield":
      return <YieldFields form={form} />;
    case "pvsyst":
      return <PvsystFields form={form} />;
    case "financial":
      return <FinancialFields form={form} />;
    case "cybersecurity":
      return <CybersecurityFields form={form} />;
  }
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function SelectField({
  form,
  name,
  label,
  options,
}: {
  form: F;
  name: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const err = (form.formState.errors as any)[name];
  const value = form.watch(name);
  return (
    <FieldShell label={label} error={err}>
      <Select
        value={value ?? ""}
        onValueChange={(v) => form.setValue(name, v, { shouldDirty: true })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function TextField({
  form,
  name,
  label,
  suffix,
  type = "text",
  placeholder,
}: {
  form: F;
  name: string;
  label: string;
  suffix?: string;
  type?: string;
  placeholder?: string;
}) {
  const err = (form.formState.errors as any)[name];
  return (
    <FieldShell label={label} suffix={suffix} error={err}>
      <Input
        type={type}
        step={type === "number" ? "any" : undefined}
        placeholder={placeholder}
        className={suffix ? "pr-14" : undefined}
        {...form.register(name)}
      />
    </FieldShell>
  );
}

function BoolField({
  form,
  name,
  label,
  hint,
}: {
  form: F;
  name: string;
  label: string;
  hint?: string;
}) {
  const value = !!form.watch(name);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Switch
        checked={value}
        onCheckedChange={(v) => form.setValue(name, v, { shouldDirty: true })}
      />
    </div>
  );
}

function TextareaField({
  form,
  name,
  label,
  placeholder,
}: {
  form: F;
  name: string;
  label: string;
  placeholder?: string;
}) {
  const err = (form.formState.errors as any)[name];
  return (
    <FieldShell label={label} error={err} className="col-span-full">
      <Textarea rows={3} placeholder={placeholder} {...form.register(name)} />
    </FieldShell>
  );
}

function PvFields({ form }: { form: F }) {
  return (
    <Grid>
      <SelectField
        form={form}
        name="tracker_type"
        label="Tracker type"
        options={[
          { value: "fixed", label: "Fixed tilt" },
          { value: "single_axis", label: "Single-axis" },
          { value: "dual_axis", label: "Dual-axis" },
        ]}
      />
      <TextField
        form={form}
        name="module_type"
        label="Module type"
        placeholder="Bifacial mono PERC"
      />
      <TextField form={form} name="tilt_deg" label="Tilt" suffix="°" type="number" />
      <TextField form={form} name="gcr" label="GCR" type="number" />
      <TextField form={form} name="dc_ac_ratio" label="DC/AC ratio" type="number" />
      <TextField
        form={form}
        name="dc_capacity_mwp"
        label="DC capacity"
        suffix="MWp"
        type="number"
      />
      <TextField form={form} name="inverter_count" label="Inverter count" type="number" />
    </Grid>
  );
}

function BessFields({ form }: { form: F }) {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <SelectField
          form={form}
          name="chemistry"
          label="Chemistry"
          options={[
            { value: "lfp", label: "LFP" },
            { value: "nmc", label: "NMC" },
            { value: "flow", label: "Flow" },
            { value: "other", label: "Other" },
          ]}
        />
        <TextField form={form} name="power_mw" label="Power" suffix="MW" type="number" />
        <TextField form={form} name="energy_mwh" label="Energy" suffix="MWh" type="number" />
        <TextField form={form} name="duration_hours" label="Duration" suffix="h" type="number" />
        <TextField form={form} name="pcs_count" label="PCS count" type="number" />
        <TextField form={form} name="container_count" label="Container count" type="number" />
        <TextField form={form} name="cycles_per_day" label="Cycles / day" type="number" />
      </Grid>
      <TextareaField form={form} name="augmentation_strategy" label="Augmentation strategy" />
    </div>
  );
}

function SubstationFields({ form }: { form: F }) {
  return (
    <Grid>
      <TextField form={form} name="voltage_kv" label="Voltage" suffix="kV" type="number" />
      <TextField form={form} name="transformer_count" label="Transformer count" type="number" />
      <TextField
        form={form}
        name="transformer_mva"
        label="Transformer"
        suffix="MVA"
        type="number"
      />
      <TextField form={form} name="bay_count" label="Bay count" type="number" />
      <TextField form={form} name="busbar_scheme" label="Busbar scheme" />
      <TextField form={form} name="grid_code" label="Grid code" />
    </Grid>
  );
}

function SldFields({ form }: { form: F }) {
  return (
    <div className="flex flex-col gap-5">
      <Grid>
        <TextField form={form} name="hv_voltage_kv" label="HV" suffix="kV" type="number" />
        <TextField form={form} name="mv_voltage_kv" label="MV" suffix="kV" type="number" />
        <TextField form={form} name="lv_voltage_kv" label="LV" suffix="kV" type="number" />
      </Grid>
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">Voltage levels</p>
        <KeyValueEditor
          control={form.control}
          name="voltage_levels"
          keyPlaceholder="Name (e.g. MV bus)"
          valuePlaceholder="kV"
          disabled={form.formState.isSubmitting}
        />
      </div>
    </div>
  );
}

function ScadaFields({ form }: { form: F }) {
  return (
    <Grid>
      <SelectField
        form={form}
        name="protocol"
        label="Protocol"
        options={[
          { value: "modbus_tcp", label: "Modbus TCP" },
          { value: "iec61850", label: "IEC 61850" },
          { value: "dnp3", label: "DNP3" },
          { value: "opc_ua", label: "OPC UA" },
        ]}
      />
      <TextField
        form={form}
        name="polling_interval_sec"
        label="Polling interval"
        suffix="s"
        type="number"
      />
      <TextField form={form} name="points_count" label="Points count" type="number" />
      <TextField
        form={form}
        name="historian_retention_days"
        label="Historian retention"
        suffix="days"
        type="number"
      />
    </Grid>
  );
}

function YieldFields({ form }: { form: F }) {
  return (
    <Grid>
      <TextField form={form} name="p50_mwh" label="P50" suffix="MWh" type="number" />
      <TextField form={form} name="p90_mwh" label="P90" suffix="MWh" type="number" />
      <TextField form={form} name="ghi_kwh_m2" label="GHI" suffix="kWh/m²" type="number" />
      <TextField form={form} name="losses_pct" label="Losses" suffix="%" type="number" />
      <TextField form={form} name="degradation_pct" label="Degradation" suffix="%" type="number" />
      <TextField
        form={form}
        name="availability_pct"
        label="Availability"
        suffix="%"
        type="number"
      />
    </Grid>
  );
}

function PvsystFields({ form }: { form: F }) {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <TextField form={form} name="pvsyst_version" label="PVsyst version" placeholder="7.4" />
        <TextField form={form} name="meteo_source" label="Meteo source" placeholder="Meteonorm 8" />
        <TextField
          form={form}
          name="near_shading_pct"
          label="Near shading"
          suffix="%"
          type="number"
        />
        <TextField form={form} name="albedo" label="Albedo" type="number" />
        <TextField
          form={form}
          name="sim_report_url"
          label="Sim report URL"
          placeholder="https://…"
        />
        <BoolField
          form={form}
          name="bifacial"
          label="Bifacial modules"
          hint="Include rear-side gains in modeling"
        />
      </Grid>
    </div>
  );
}

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "INR", "BRL", "MXN", "JPY", "CAD"];

function FinancialFields({ form }: { form: F }) {
  return (
    <Grid>
      <SelectField
        form={form}
        name="currency_code"
        label="Currency"
        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
      />
      <TextField form={form} name="capex_total" label="Total CAPEX" type="number" />
      <TextField form={form} name="contingency_pct" label="Contingency" suffix="%" type="number" />
      <TextField form={form} name="debt_ratio_pct" label="Debt ratio" suffix="%" type="number" />
      <TextField
        form={form}
        name="discount_rate_pct"
        label="Discount rate"
        suffix="%"
        type="number"
      />
      <TextField form={form} name="ppa_price" label="PPA price" type="number" />
      <TextField
        form={form}
        name="contract_years"
        label="Contract length"
        suffix="yrs"
        type="number"
      />
    </Grid>
  );
}

function CybersecurityFields({ form }: { form: F }) {
  return (
    <div className="flex flex-col gap-5">
      <Grid>
        <SelectField
          form={form}
          name="standard"
          label="Standard"
          options={[
            { value: "iec62443", label: "IEC 62443" },
            { value: "nerc_cip", label: "NERC CIP" },
            { value: "iso27019", label: "ISO 27019" },
          ]}
        />
        <BoolField form={form} name="soc_monitoring" label="24/7 SOC monitoring" />
      </Grid>
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">Zones &amp; conduits</p>
        <KeyValueEditor
          control={form.control}
          name="zones_conduits"
          keyPlaceholder="Zone name"
          valuePlaceholder="Conduit / notes"
          disabled={form.formState.isSubmitting}
        />
      </div>
      <TextareaField form={form} name="remote_access_policy" label="Remote access policy" />
    </div>
  );
}
