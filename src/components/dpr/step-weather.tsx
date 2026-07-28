// P-086 — Weather step: summary + high/low + zero-or-more delay rows.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CloudRain, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { dprDetailQueryOptions, errorMessage } from "@/lib/dpr-query";
import {
  addWeatherDelay,
  deleteWeatherDelay,
  upsertDprHeader,
  type DprRow,
  type WeatherDelayRow,
} from "@/lib/dpr.functions";
import { WEATHER_DELAY_TYPES, type WeatherDelayType } from "@/lib/dpr.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const DELAY_LABELS: Record<WeatherDelayType, string> = {
  rain: "Rain",
  wind: "Wind",
  heat: "Heat",
  cold: "Cold",
  dust_storm: "Dust storm",
  lightning: "Lightning",
  other: "Other",
};

interface Props {
  header: DprRow;
  delays: WeatherDelayRow[];
  readOnly: boolean;
}

export function StepWeather({ header, delays, readOnly }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: dprDetailQueryOptions(header.id).queryKey,
    });
  const upsert = useServerFn(upsertDprHeader);
  const addDelay = useServerFn(addWeatherDelay);
  const delDelay = useServerFn(deleteWeatherDelay);

  const [summary, setSummary] = useState(header.weather_summary ?? "");
  const [high, setHigh] = useState<string>(
    header.temperature_high_c == null ? "" : String(header.temperature_high_c),
  );
  const [low, setLow] = useState<string>(
    header.temperature_low_c == null ? "" : String(header.temperature_low_c),
  );

  const saveHeader = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: header.id,
          projectId: header.project_id,
          reportDate: header.report_date,
          shift: header.shift,
          weatherSummary: summary.trim() || null,
          temperatureHighC: high === "" ? null : Number(high),
          temperatureLowC: low === "" ? null : Number(low),
          workSummary: header.work_summary,
          constraintsNotes: header.constraints_notes,
        },
      }),
    onSuccess: () => {
      toast.success(t("fieldMod.dpr.weather.weatherSaved"));
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [type, setType] = useState<WeatherDelayType>("rain");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [lost, setLost] = useState<string>("");
  const [note, setNote] = useState("");

  const addMut = useMutation({
    mutationFn: () =>
      addDelay({
        data: {
          dprId: header.id,
          delayType: type,
          startTime: startTime || null,
          endTime: endTime || null,
          lostHours: Number(lost) || 0,
          wbsItemId: null,
          impactNotes: note.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("fieldMod.dpr.weather.delayLogged"));
      setLost("");
      setNote("");
      setStartTime("");
      setEndTime("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delDelay({ data: { id, dprId: header.id } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudRain className="h-4 w-4" aria-hidden /> {t("fieldMod.dpr.weather.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-summary">{t("fieldMod.dpr.weather.summary")}</Label>
            <Textarea
              id="w-summary"
              rows={2}
              maxLength={500}
              disabled={readOnly}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t("fieldMod.dpr.weather.summaryPlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="w-high">{t("fieldMod.dpr.weather.high")}</Label>
              <Input
                id="w-high"
                type="number"
                dir="ltr"
                inputMode="decimal"
                className="h-11"
                disabled={readOnly}
                value={high}
                onChange={(e) => setHigh(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="w-low">{t("fieldMod.dpr.weather.low")}</Label>
              <Input
                id="w-low"
                type="number"
                dir="ltr"
                inputMode="decimal"
                className="h-11"
                disabled={readOnly}
                value={low}
                onChange={(e) => setLow(e.target.value)}
              />
            </div>
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={saveHeader.isPending}
              onClick={() => saveHeader.mutate()}
            >
              {t("fieldMod.dpr.weather.saveWeather")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("fieldMod.dpr.weather.delays")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {delays.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("fieldMod.dpr.weather.noDelays")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {delays.map((d) => (
                <li
                  key={d.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {DELAY_LABELS[d.delay_type as WeatherDelayType] ?? d.delay_type}
                      {" · "}
                      {Number(d.lost_hours).toFixed(1)} h lost
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.start_time && d.end_time
                        ? `${d.start_time.slice(0, 5)} → ${d.end_time.slice(0, 5)} · `
                        : ""}
                      {d.impact_notes ?? ""}
                    </div>
                  </div>
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => delMut.mutate(d.id)}
                      disabled={delMut.isPending}
                      aria-label={t("fieldMod.dpr.weather.removeDelay")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
            <div className="rounded-md border border-dashed border-border p-3">
              <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
                {t("fieldMod.dpr.weather.logDelay")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("fieldMod.dpr.weather.type")}</Label>
                  <Select value={type} onValueChange={(v) => setType(v as WeatherDelayType)}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEATHER_DELAY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {DELAY_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="w-lost">{t("fieldMod.dpr.weather.lostHours")}</Label>
                  <Input
                    id="w-lost"
                    type="number"
                    dir="ltr"
                    inputMode="decimal"
                    step="0.5"
                    min={0}
                    max={24}
                    className="h-11"
                    value={lost}
                    onChange={(e) => setLost(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="w-start">{t("fieldMod.dpr.weather.start")}</Label>
                  <Input
                    id="w-start"
                    type="time"
                    className="h-11"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="w-end">{t("fieldMod.dpr.weather.end")}</Label>
                  <Input
                    id="w-end"
                    type="time"
                    className="h-11"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <Label htmlFor="w-note">{t("fieldMod.dpr.weather.impactNote")}</Label>
                <Textarea
                  id="w-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="mt-3 h-11 w-full"
                disabled={addMut.isPending || Number(lost) <= 0}
                onClick={() => addMut.mutate()}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t("fieldMod.dpr.weather.addDelay")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
