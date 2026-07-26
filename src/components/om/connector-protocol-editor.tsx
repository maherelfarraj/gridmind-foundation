// P-172 — Per-protocol mapping + scheduled-pull editor for a SCADA connector.
// Persists into scada_connectors.config (jsonb) via updateScadaConnector,
// which re-checks om_admin/scada_admin server-side and writes an audit row.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  MODBUS_DATA_TYPES,
  MODBUS_REGISTER_TYPES,
  PROTOCOL_EDITOR_LABELS,
  emptyProtocolConfig,
  protocolEditorFor,
  protocolSchemaFor,
  scheduleSchema,
  type ProtocolEditor,
} from "@/lib/scada/connector-config";
import { updateScadaConnector, type ConnectorRow } from "@/lib/scada.functions";

type Row = Record<string, unknown>;

const ROWS_KEY: Record<ProtocolEditor, string> = {
  mqtt: "payload_mappings",
  opcua: "node_mappings",
  modbus: "register_mappings",
};

const EMPTY_ROW: Record<ProtocolEditor, Row> = {
  mqtt: { tag: "", json_path: "", metric: "" },
  opcua: { tag: "", node_id: "", metric: "" },
  modbus: {
    tag: "",
    unit_id: 1,
    register: 0,
    register_type: "holding",
    data_type: "float32",
    scaling_factor: 1,
    scaling_offset: 0,
  },
};

export function ConnectorProtocolEditor({
  connector,
  open,
  onOpenChange,
  companyId,
}: {
  connector: ConnectorRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
}) {
  const editor = protocolEditorFor(connector.connector_type);
  const baseConfig = useMemo(
    () => (connector.config ?? {}) as Record<string, unknown>,
    [connector.config],
  );

  const [proto, setProto] = useState<Row>(() => {
    if (!editor) return {};
    return {
      ...emptyProtocolConfig(editor),
      ...((baseConfig[editor] as Row | undefined) ?? {}),
    };
  });
  const [schedule, setSchedule] = useState<Row>(() => ({
    enabled: false,
    interval_minutes: 15,
    pull_url: "",
    ...((baseConfig.schedule as Row | undefined) ?? {}),
  }));

  const qc = useQueryClient();
  const updateFn = useServerFn(updateScadaConnector);
  const save = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("unsupported_protocol");
      const protoParsed = protocolSchemaFor(editor).parse(proto);
      const schedParsed = scheduleSchema.parse({
        ...schedule,
        pull_url: (schedule.pull_url as string) || undefined,
      });
      return updateFn({
        data: {
          id: connector.id,
          config: { ...baseConfig, [editor]: protoParsed, schedule: schedParsed },
        },
      });
    },
    onSuccess: () => {
      toast.success("Mapping configuration saved");
      qc.invalidateQueries({ queryKey: ["scada", "connectors", companyId] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save mapping configuration");
    },
  });

  if (!editor) return null;
  const rowsKey = ROWS_KEY[editor];
  const rows = (proto[rowsKey] as Row[] | undefined) ?? [];

  const setRows = (next: Row[]) => setProto((p) => ({ ...p, [rowsKey]: next }));
  const patchRow = (i: number, patch: Row) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle>
            {PROTOCOL_EDITOR_LABELS[editor]} mapping · {connector.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Mapping rows resolve against the project tag dictionary. Credentials stay as an
            environment-variable name on the connector — never enter secret values here.
          </DialogDescription>
        </DialogHeader>

        {editor === "mqtt" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Broker host">
              <Input
                value={String(proto.broker_host ?? "")}
                onChange={(e) => setProto((p) => ({ ...p, broker_host: e.target.value }))}
                placeholder="mqtt.plant.example"
              />
            </Field>
            <Field label="Broker port">
              <Input
                type="number"
                value={String(proto.broker_port ?? 8883)}
                onChange={(e) => setProto((p) => ({ ...p, broker_port: e.target.value }))}
              />
            </Field>
            <Field label="Topic template">
              <Input
                value={String(proto.topic_template ?? "")}
                onChange={(e) => setProto((p) => ({ ...p, topic_template: e.target.value }))}
                placeholder="plants/{asset_key}/{tag}"
              />
            </Field>
            <Field label="QoS">
              <Select
                value={String(proto.qos ?? 1)}
                onValueChange={(v) => setProto((p) => ({ ...p, qos: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2].map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      QoS {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {editor === "opcua" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Endpoint URL">
              <Input
                value={String(proto.endpoint_url ?? "")}
                onChange={(e) => setProto((p) => ({ ...p, endpoint_url: e.target.value }))}
                placeholder="opc.tcp://gateway.plant:4840"
              />
            </Field>
            <Field label="Namespace index">
              <Input
                type="number"
                value={String(proto.namespace ?? 2)}
                onChange={(e) => setProto((p) => ({ ...p, namespace: e.target.value }))}
              />
            </Field>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Mapping rows ({rows.length})</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRows([...rows, { ...EMPTY_ROW[editor] }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add row
            </Button>
          </div>

          {rows.length === 0 && (
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              No mapping rows yet. Add one row per tag you want this connector to publish.
            </p>
          )}

          {rows.map((row, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))_auto]"
            >
              <Input
                aria-label="Tag"
                placeholder="tag"
                value={String(row.tag ?? "")}
                onChange={(e) => patchRow(i, { tag: e.target.value })}
              />
              {editor === "mqtt" && (
                <>
                  <Input
                    aria-label="JSON path"
                    placeholder="$.payload.active_power"
                    value={String(row.json_path ?? "")}
                    onChange={(e) => patchRow(i, { json_path: e.target.value })}
                  />
                  <Input
                    aria-label="Metric"
                    placeholder="metric"
                    value={String(row.metric ?? "")}
                    onChange={(e) => patchRow(i, { metric: e.target.value })}
                  />
                </>
              )}
              {editor === "opcua" && (
                <>
                  <Input
                    aria-label="NodeId"
                    placeholder="ns=2;s=Plant.INV01.P"
                    value={String(row.node_id ?? "")}
                    onChange={(e) => patchRow(i, { node_id: e.target.value })}
                  />
                  <Input
                    aria-label="Metric"
                    placeholder="metric"
                    value={String(row.metric ?? "")}
                    onChange={(e) => patchRow(i, { metric: e.target.value })}
                  />
                </>
              )}
              {editor === "modbus" && (
                <>
                  <Input
                    aria-label="Unit id"
                    type="number"
                    value={String(row.unit_id ?? 1)}
                    onChange={(e) => patchRow(i, { unit_id: e.target.value })}
                  />
                  <Input
                    aria-label="Register"
                    type="number"
                    value={String(row.register ?? 0)}
                    onChange={(e) => patchRow(i, { register: e.target.value })}
                  />
                  <Select
                    value={String(row.register_type ?? "holding")}
                    onValueChange={(v) => patchRow(i, { register_type: v })}
                  >
                    <SelectTrigger aria-label="Register type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODBUS_REGISTER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(row.data_type ?? "float32")}
                    onValueChange={(v) => patchRow(i, { data_type: v })}
                  >
                    <SelectTrigger aria-label="Data type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODBUS_DATA_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="Scaling factor"
                    type="number"
                    value={String(row.scaling_factor ?? 1)}
                    onChange={(e) => patchRow(i, { scaling_factor: e.target.value })}
                  />
                  <Input
                    aria-label="Scaling offset"
                    type="number"
                    value={String(row.scaling_offset ?? 0)}
                    onChange={(e) => patchRow(i, { scaling_offset: e.target.value })}
                  />
                </>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove row"
                onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Scheduled pull</Label>
              <p className="text-xs text-muted-foreground">
                Configuration only — execution lands with the ingestion cron.
              </p>
            </div>
            <Switch
              checked={Boolean(schedule.enabled)}
              onCheckedChange={(v) => setSchedule((s) => ({ ...s, enabled: v }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interval (minutes)">
              <Input
                type="number"
                value={String(schedule.interval_minutes ?? 15)}
                onChange={(e) => setSchedule((s) => ({ ...s, interval_minutes: e.target.value }))}
              />
            </Field>
            <Field label="Pull URL">
              <Input
                value={String(schedule.pull_url ?? "")}
                onChange={(e) => setSchedule((s) => ({ ...s, pull_url: e.target.value }))}
                placeholder="https://historian.example/api/pull"
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
