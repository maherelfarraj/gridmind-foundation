// P-138 — Right dock: properties of the selected object.
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
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { symbolDef, symbolRecord } from "@/lib/sld/symbols";
import { coercePropertyValue } from "@/lib/sld/symbol-registry";

const ROTATIONS = [0, 90, 180, 270] as const;

export function PropertiesPanel({ editable }: { editable: boolean }) {
  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const layers = useCanvasStore((s) => s.layers);
  const setObjectProps = useCanvasStore((s) => s.setObjectProps);

  const obj = selection.length === 1 ? objects.find((o) => o.id === selection[0]) : undefined;

  if (!obj) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Properties
        </p>
        <p className="text-sm text-muted-foreground">
          {selection.length > 1
            ? `${selection.length} objects selected`
            : "Select an object to edit its properties."}
        </p>
      </div>
    );
  }

  const def = symbolDef(obj.symbol_type);
  const record = symbolRecord(obj.symbol_type);
  const schema = record?.property_schema ?? [];
  const props = (obj.properties ?? {}) as Record<string, unknown>;
  const setProp = (key: string, value: string | number | boolean | null) =>
    setObjectProps(obj.id, { properties: { ...props, [key]: value } });
  const disabled = !editable;

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Properties
      </p>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Symbol</Label>
        <p className="text-sm font-medium">{def.label}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="obj-tag" className="text-xs text-muted-foreground">
          Tag
        </Label>
        <Input
          id="obj-tag"
          value={obj.tag ?? ""}
          disabled={disabled}
          onChange={(e) => setObjectProps(obj.id, { tag: e.target.value || null })}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="obj-label" className="text-xs text-muted-foreground">
          Label
        </Label>
        <Input
          id="obj-label"
          value={obj.label ?? ""}
          disabled={disabled}
          onChange={(e) => setObjectProps(obj.id, { label: e.target.value || null })}
          className="h-8"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="obj-x" className="text-xs text-muted-foreground">
            X (mm)
          </Label>
          <Input
            id="obj-x"
            type="number"
            value={Math.round(obj.x * 10) / 10}
            disabled={disabled}
            onChange={(e) => setObjectProps(obj.id, { x: Number(e.target.value) || 0 })}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="obj-y" className="text-xs text-muted-foreground">
            Y (mm)
          </Label>
          <Input
            id="obj-y"
            type="number"
            value={Math.round(obj.y * 10) / 10}
            disabled={disabled}
            onChange={(e) => setObjectProps(obj.id, { y: Number(e.target.value) || 0 })}
            className="h-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Rotation</Label>
        <Select
          value={String(obj.rotation)}
          disabled={disabled}
          onValueChange={(v) =>
            setObjectProps(obj.id, { rotation: Number(v) as 0 | 90 | 180 | 270 })
          }
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROTATIONS.map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r}°
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Layer</Label>
        <Select
          value={obj.layer_id}
          disabled={disabled}
          onValueChange={(v) => setObjectProps(obj.id, { layer_id: v })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {layers
              .filter((l) => !l.system)
              .map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {schema.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {record?.display_name} attributes
          </p>
          {schema.map((field) => {
            const id = `prop-${field.key}`;
            const value = props[field.key];
            if (field.type === "bool") {
              return (
                <div
                  key={field.key}
                  className="flex items-center justify-between rounded-md border border-border px-2 py-1.5"
                >
                  <Label htmlFor={id} className="text-sm">
                    {field.label}
                  </Label>
                  <Switch
                    id={id}
                    checked={Boolean(value)}
                    disabled={disabled}
                    onCheckedChange={(v) => setProp(field.key, coercePropertyValue(field, v))}
                  />
                </div>
              );
            }
            if (field.type === "select") {
              return (
                <div key={field.key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{field.label}</Label>
                  <Select
                    value={value === null || value === undefined ? "" : String(value)}
                    disabled={disabled}
                    onValueChange={(v) => setProp(field.key, coercePropertyValue(field, v))}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            return (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {field.label}
                  {field.unit ? ` (${field.unit})` : ""}
                  {field.required ? " *" : ""}
                </Label>
                <Input
                  id={id}
                  type={field.type === "number" ? "number" : "text"}
                  value={value === null || value === undefined ? "" : String(value)}
                  min={field.min}
                  max={field.max}
                  disabled={disabled}
                  onChange={(e) => setProp(field.key, coercePropertyValue(field, e.target.value))}
                  className="h-8"
                />
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
        <Label htmlFor="obj-mirror" className="text-sm">
          Mirrored
        </Label>
        <Switch
          id="obj-mirror"
          checked={obj.mirrored}
          disabled={disabled}
          onCheckedChange={(v) => setObjectProps(obj.id, { mirrored: v })}
        />
      </div>
    </div>
  );
}
