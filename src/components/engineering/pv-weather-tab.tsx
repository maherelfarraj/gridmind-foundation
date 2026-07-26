// P-151 — Weather dataset, loss assumptions, grid limits and targets.
import { useRef } from "react";
import { FileUp, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  MONTH_LABELS,
  PV_WEATHER_SOURCES,
  PV_WEATHER_SOURCE_LABELS,
  type MountingType,
  type PvWeatherMeta,
  type PvWeatherSource,
} from "@/lib/pv-site.schemas";
import { useOpenPvSiteFile, useUploadPvWeatherFile } from "@/lib/pv-site-query";

interface Props {
  projectId: string;
  weatherSource: PvWeatherSource;
  albedo: number;
  meta: PvWeatherMeta;
  readOnly: boolean;
  onWeatherSourceChange: (source: PvWeatherSource) => void;
  onAlbedoChange: (albedo: number) => void;
  onMetaChange: (patch: Partial<PvWeatherMeta>) => void;
}

function numOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function PvWeatherTab({
  projectId,
  weatherSource,
  albedo,
  meta,
  readOnly,
  onWeatherSourceChange,
  onAlbedoChange,
  onMetaChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadPvWeatherFile(projectId);
  const openFile = useOpenPvSiteFile();

  const albedoInvalid = albedo < 0.05 || albedo > 0.9;
  const soilingInvalid = meta.soiling_monthly_pct.some((v) => v < 0 || v > 30);
  const targets = meta.targets;
  const isTracker = targets.mounting_type === "single_axis_tracker";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weather dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select
              value={weatherSource}
              disabled={readOnly}
              onValueChange={(v) => onWeatherSourceChange(v as PvWeatherSource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PV_WEATHER_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PV_WEATHER_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataset-label">Dataset label</Label>
            <Input
              id="dataset-label"
              placeholder="PVGIS-SARAH3 2005–2023"
              value={meta.dataset_label ?? ""}
              disabled={readOnly}
              onChange={(e) => onMetaChange({ dataset_label: e.target.value || null })}
            />
          </div>

          {weatherSource === "custom_tmy" ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Custom TMY file</p>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".csv,.epw,.tmy,.txt,.xlsx,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const path = await upload.mutateAsync(file);
                  onMetaChange({ source_file: path });
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={readOnly || upload.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  {upload.isPending ? "Uploading…" : "Upload TMY"}
                </Button>
                {meta.source_file ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openFile.mutate(meta.source_file!)}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" /> Open uploaded file
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">No file uploaded yet</span>
                )}
              </div>
              {meta.source_file ? (
                <p className="break-all text-xs text-muted-foreground">{meta.source_file}</p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <NumField
              label="GHI kWh/m²/yr"
              value={meta.ghi_kwh_m2_yr}
              disabled={readOnly}
              onChange={(v) => onMetaChange({ ghi_kwh_m2_yr: v })}
            />
            <NumField
              label="Avg ambient °C"
              value={meta.avg_ambient_c}
              disabled={readOnly}
              onChange={(v) => onMetaChange({ avg_ambient_c: v })}
            />
            <NumField
              label="Avg wind m/s"
              value={meta.avg_wind_ms}
              disabled={readOnly}
              onChange={(v) => onMetaChange({ avg_wind_ms: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="albedo">Albedo (0.05–0.9)</Label>
            <Input
              id="albedo"
              type="number"
              step="0.01"
              value={albedo}
              disabled={readOnly}
              aria-invalid={albedoInvalid}
              onChange={(e) => onAlbedoChange(Number(e.target.value))}
            />
            {albedoInvalid ? (
              <p className="text-xs text-destructive">Albedo must be between 0.05 and 0.9.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly soiling losses %</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {MONTH_LABELS.map((m, i) => (
              <div key={m} className="space-y-1">
                <Label htmlFor={`soil-${m}`} className="text-xs">
                  {m}
                </Label>
                <Input
                  id={`soil-${m}`}
                  type="number"
                  step="0.1"
                  min={0}
                  max={30}
                  value={meta.soiling_monthly_pct[i] ?? 0}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = [...meta.soiling_monthly_pct];
                    next[i] = Number(e.target.value);
                    onMetaChange({ soiling_monthly_pct: next });
                  }}
                />
              </div>
            ))}
          </div>
          {soilingInvalid ? (
            <p className="text-xs text-destructive">Monthly soiling must stay within 0–30%.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Exactly 12 values are stored — one per calendar month.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Grid limits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <NumField
            label="Max export kW"
            value={meta.grid.max_export_kw}
            disabled={readOnly}
            onChange={(v) => onMetaChange({ grid: { ...meta.grid, max_export_kw: v } })}
          />
          <NumField
            label="POI voltage kV"
            value={meta.grid.poi_voltage_kv}
            disabled={readOnly}
            onChange={(v) => onMetaChange({ grid: { ...meta.grid, poi_voltage_kv: v } })}
          />
          <NumField
            label="Curtailment %"
            value={meta.grid.curtailment_pct}
            disabled={readOnly}
            onChange={(v) => onMetaChange({ grid: { ...meta.grid, curtailment_pct: v } })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Targets &amp; mounting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField
              label="Target DC kWp"
              value={targets.target_dc_kwp}
              disabled={readOnly}
              onChange={(v) => onMetaChange({ targets: { ...targets, target_dc_kwp: v } })}
            />
            <NumField
              label="Target AC kWp"
              value={targets.target_ac_kwp}
              disabled={readOnly}
              onChange={(v) => onMetaChange({ targets: { ...targets, target_ac_kwp: v } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Mounting type</Label>
            <Select
              value={targets.mounting_type}
              disabled={readOnly}
              onValueChange={(v) =>
                onMetaChange({ targets: { ...targets, mounting_type: v as MountingType } })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_tilt">Fixed tilt</SelectItem>
                <SelectItem value="single_axis_tracker">Single-axis tracker</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isTracker ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <NumField
                label="Axis azimuth °"
                value={targets.axis_azimuth_deg}
                disabled={readOnly}
                onChange={(v) => onMetaChange({ targets: { ...targets, axis_azimuth_deg: v } })}
              />
              <NumField
                label="Rotation limit ±°"
                value={targets.rotation_limit_deg}
                disabled={readOnly}
                onChange={(v) => onMetaChange({ targets: { ...targets, rotation_limit_deg: v } })}
              />
              <div className="flex items-center gap-2 pt-6">
                <Switch
                  id="backtracking"
                  checked={targets.backtracking}
                  disabled={readOnly}
                  onCheckedChange={(v) =>
                    onMetaChange({ targets: { ...targets, backtracking: v } })
                  }
                />
                <Label htmlFor="backtracking">Backtracking</Label>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                label="Tilt °"
                value={targets.tilt_deg}
                disabled={readOnly}
                onChange={(v) => onMetaChange({ targets: { ...targets, tilt_deg: v } })}
              />
              <NumField
                label="Azimuth °"
                value={targets.azimuth_deg}
                disabled={readOnly}
                onChange={(v) => onMetaChange({ targets: { ...targets, azimuth_deg: v } })}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const id = label.replace(/[^a-zA-Z]/g, "-").toLowerCase();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step="any"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(numOrNull(e.target.value))}
      />
    </div>
  );
}
