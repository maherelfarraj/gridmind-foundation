import { useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Radio as RadioIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ASSET_TYPES,
  CONNECTOR_TYPES,
  EQUIPMENT_TYPES,
  connectorConfigSchema,
  credentialsRefSchema,
  type AssetType,
  type ConnectorType,
} from "@/lib/scada-rules";
import {
  createScadaConnector,
  listScadaProjectOptions,
  testScadaConnector,
  upsertScadaAssets,
} from "@/lib/scada.functions";

const assetRowSchema = z.object({
  asset_key: z.string().trim().min(1, "Required"),
  asset_type: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1, "Required"),
  equipment_tag: z.string().trim().min(1, "Required"),
  equipment_type: z.enum(EQUIPMENT_TYPES),
  manufacturer: z.string().trim().max(80).optional().or(z.literal("")),
  model: z.string().trim().max(80).optional().or(z.literal("")),
});

const wizardSchema = z
  .object({
    asset_kind: z.enum(ASSET_TYPES),
    project_id: z.string().uuid("Pick a project"),
    name: z.string().trim().min(2, "At least 2 chars"),
    connector_type: z.enum(CONNECTOR_TYPES),
    // Free-form; validated per connector_type on submit.
    config_host: z.string().trim().optional(),
    config_port: z.string().trim().optional(),
    config_unit_ids: z.string().trim().optional(),
    config_poll: z.string().trim().optional(),
    config_broker_url: z.string().trim().optional(),
    config_topic: z.string().trim().optional(),
    config_base_url: z.string().trim().optional(),
    config_source_label: z.string().trim().optional(),
    credentials_ref: z.string().trim().optional(),
    assets: z.array(assetRowSchema).min(1, "Add at least one asset"),
  })
  .superRefine((val, ctx) => {
    if (val.credentials_ref && val.credentials_ref.length > 0) {
      const r = credentialsRefSchema.safeParse(val.credentials_ref);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["credentials_ref"],
          message: r.error.issues[0]?.message ?? "Invalid variable name",
        });
      }
    }
  });

type WizardValues = z.infer<typeof wizardSchema>;

function buildConfig(values: WizardValues): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (values.credentials_ref) cfg.credentials_ref = values.credentials_ref;
  switch (values.connector_type) {
    case "modbus_tcp":
    case "sunspec":
      cfg.host = values.config_host;
      cfg.port = values.config_port;
      cfg.unit_ids = (values.config_unit_ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));
      if (values.config_poll) cfg.poll_interval_s = values.config_poll;
      break;
    case "iec61850":
      cfg.host = values.config_host;
      cfg.port = values.config_port;
      if (values.config_poll) cfg.poll_interval_s = values.config_poll;
      break;
    case "mqtt":
      cfg.broker_url = values.config_broker_url;
      cfg.topic = values.config_topic;
      if (values.config_poll) cfg.poll_interval_s = values.config_poll;
      break;
    case "vendor_api":
      cfg.base_url = values.config_base_url;
      if (values.config_poll) cfg.poll_interval_s = values.config_poll;
      break;
    case "csv_import":
      cfg.source_label = values.config_source_label;
      break;
  }
  return cfg;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

export function ScadaConnectorWizard({ open, onOpenChange, companyId }: Props) {
  const [step, setStep] = useState(1);
  const qc = useQueryClient();
  const projectsFn = useServerFn(listScadaProjectOptions);
  const projectsQuery = useQuery({
    queryKey: ["scada", "projects", companyId],
    queryFn: () => projectsFn({ data: { companyId } }),
    enabled: open && Boolean(companyId),
  });

  const form = useForm<WizardValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      asset_kind: "inverter",
      project_id: "",
      name: "",
      connector_type: "modbus_tcp",
      config_port: "502",
      config_poll: "5",
      credentials_ref: "",
      assets: [
        {
          asset_key: "",
          asset_type: "inverter",
          name: "",
          equipment_tag: "",
          equipment_type: "inverter",
          manufacturer: "",
          model: "",
        },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "assets",
  });

  const connectorType = form.watch("connector_type");
  const assetKind = form.watch("asset_kind");

  const createFn = useServerFn(createScadaConnector);
  const upsertFn = useServerFn(upsertScadaAssets);
  const testFn = useServerFn(testScadaConnector);

  const saveMut = useMutation({
    mutationFn: async (values: WizardValues) => {
      // Validate config shape per connector type before hitting the server.
      const cfg = buildConfig(values);
      connectorConfigSchema(values.connector_type).parse(cfg);
      const created = await createFn({
        data: {
          project_id: values.project_id,
          name: values.name,
          connector_type: values.connector_type,
          asset_kind: values.asset_kind,
          config: cfg,
        },
      });
      await upsertFn({
        data: {
          connector_id: created.id,
          assets: values.assets.map((a) => ({
            asset_key: a.asset_key,
            asset_type: a.asset_type as AssetType,
            name: a.name,
            equipment: {
              tag: a.equipment_tag,
              equipment_type: a.equipment_type,
              manufacturer: a.manufacturer || undefined,
              model: a.model || undefined,
            },
          })),
        },
      });
      return created;
    },
    onSuccess: () => {
      toast.success("Connector created");
      qc.invalidateQueries({ queryKey: ["scada", "connectors", companyId] });
      form.reset();
      setStep(1);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Failed to create connector");
    },
  });

  async function handleTest() {
    // The connector isn't saved yet — this is an intent-level stub.
    toast.info("test pending — wired in B13");
    void testFn;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <RadioIcon className="h-4 w-4" />
            Add SCADA connector
          </DialogTitle>
          <DialogDescription>
            Step {step} of 3 — {step === 1 ? "stream" : step === 2 ? "connector" : "assets"}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit((v) => saveMut.mutate(v))}>
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Stream kind</Label>
                <Controller
                  control={form.control}
                  name="asset_kind"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Controller
                  control={form.control}
                  name="project_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={projectsQuery.isLoading ? "Loading…" : "Select project"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(projectsQuery.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} {p.code ? `(${p.code})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.project_id && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.project_id.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Connector name</Label>
                <Input placeholder={`${assetKind} stream A`} {...form.register("name")} />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Connector type</Label>
                <Controller
                  control={form.control}
                  name="connector_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONNECTOR_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {(connectorType === "modbus_tcp" ||
                connectorType === "iec61850" ||
                connectorType === "sunspec") && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Host</Label>
                    <Input placeholder="10.0.1.20" {...form.register("config_host")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input inputMode="numeric" {...form.register("config_port")} />
                  </div>
                  {(connectorType === "modbus_tcp" || connectorType === "sunspec") && (
                    <div className="space-y-2 col-span-2">
                      <Label>Unit IDs (comma-separated)</Label>
                      <Input placeholder="1, 2, 3" {...form.register("config_unit_ids")} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Poll interval (seconds)</Label>
                    <Input inputMode="numeric" {...form.register("config_poll")} />
                  </div>
                </div>
              )}

              {connectorType === "mqtt" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2 col-span-2">
                    <Label>Broker URL</Label>
                    <Input
                      placeholder="mqtts://broker.example.com:8883"
                      {...form.register("config_broker_url")}
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Topic</Label>
                    <Input placeholder="site/1/inverters/#" {...form.register("config_topic")} />
                  </div>
                </div>
              )}

              {connectorType === "vendor_api" && (
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input
                    placeholder="https://api.vendor.com/v1"
                    {...form.register("config_base_url")}
                  />
                </div>
              )}

              {connectorType === "csv_import" && (
                <div className="space-y-2">
                  <Label>Source label</Label>
                  <Input placeholder="Weekly export" {...form.register("config_source_label")} />
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>Credentials variable name</Label>
                <Input
                  placeholder="SCADA_VENDOR_TOKEN"
                  autoComplete="off"
                  {...form.register("credentials_ref")}
                />
                <p className="text-xs text-muted-foreground">
                  Secrets live in the Lovable Cloud secret store; enter the variable name only.
                  Never paste a real token here.
                </p>
                {form.formState.errors.credentials_ref && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.credentials_ref.message}
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={handleTest}>
                  Test connection
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Map each external SCADA asset key to a physical equipment tag.
              </p>
              <div className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
                {fields.map((f, i) => (
                  <div key={f.id} className="rounded-md border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Asset {i + 1}</span>
                      {fields.length > 1 && (
                        <Button type="button" size="icon" variant="ghost" onClick={() => remove(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Asset key</Label>
                        <Input
                          placeholder="INV-01-01"
                          {...form.register(`assets.${i}.asset_key` as const)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Asset type</Label>
                        <Controller
                          control={form.control}
                          name={`assets.${i}.asset_type` as const}
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ASSET_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Display name</Label>
                        <Input
                          placeholder="Inverter 01-01"
                          {...form.register(`assets.${i}.name` as const)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Equipment tag</Label>
                        <Input
                          placeholder="INV-01-01"
                          {...form.register(`assets.${i}.equipment_tag` as const)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Equipment type</Label>
                        <Controller
                          control={form.control}
                          name={`assets.${i}.equipment_type` as const}
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EQUIPMENT_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Manufacturer</Label>
                        <Input {...form.register(`assets.${i}.manufacturer` as const)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Model</Label>
                        <Input {...form.register(`assets.${i}.model` as const)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    asset_key: "",
                    asset_type: assetKind,
                    name: "",
                    equipment_tag: "",
                    equipment_type: "inverter",
                    manufacturer: "",
                    model: "",
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add asset
              </Button>
            </div>
          )}

          <DialogFooter className="gap-2">
            {step > 1 && (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < 3 && (
              <Button
                type="button"
                onClick={async () => {
                  const fieldsToCheck: (keyof WizardValues)[] =
                    step === 1
                      ? ["asset_kind", "project_id", "name"]
                      : ["connector_type", "credentials_ref"];
                  const ok = await form.trigger(fieldsToCheck);
                  if (ok) setStep((s) => s + 1);
                }}
              >
                Next
              </Button>
            )}
            {step === 3 && (
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Create connector"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
