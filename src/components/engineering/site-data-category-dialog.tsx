// P-052 — Per-file category + typed metadata dialog.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
import {
  SITE_DATA_CATEGORIES,
  SITE_DATA_CATEGORY_LABEL,
  type SiteDataCategory,
} from "@/lib/site-data.functions";

// ---------------------------------------------------------------------------
// Category-specific schemas
// ---------------------------------------------------------------------------
const surveySchema = z.object({
  category: z.literal("survey_topo"),
  title: z.string().trim().min(1).max(200),
  survey_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  epsg: z.string().trim().min(1).max(40),
  surveyor: z.string().trim().min(1).max(200),
  units: z.enum(["m", "ft"]),
});

const geotechSchema = z.object({
  category: z.literal("geotech"),
  title: z.string().trim().min(1).max(200),
  report_number: z.string().trim().min(1).max(80),
  lab: z.string().trim().min(1).max(200),
  boring_count: z.coerce.number().int().nonnegative(),
  groundwater_depth_m: z.coerce.number().nonnegative(),
});

const metSchema = z.object({
  category: z.literal("meteorological"),
  title: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(200),
  station: z.string().trim().min(1).max(200),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
});

const otherSchema = z.object({
  category: z.literal("other"),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).optional().default(""),
});

type SurveyForm = z.infer<typeof surveySchema>;
type GeotechForm = z.infer<typeof geotechSchema>;
type MetForm = z.infer<typeof metSchema>;
type OtherForm = z.infer<typeof otherSchema>;

export interface CategoryPayload {
  category: SiteDataCategory;
  title: string;
  tags: string[];
  metadata: Record<string, any>;
}

export function SiteDataCategoryDialog({
  fileName,
  onCancel,
  onSubmit,
}: {
  fileName: string;
  onCancel: () => void;
  onSubmit: (payload: CategoryPayload) => void;
}) {
  const [category, setCategory] = useState<SiteDataCategory>("geotech");

  return (
    <Dialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Categorize site data</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="site-data-category">Category</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as SiteDataCategory)}
          >
            <SelectTrigger id="site-data-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITE_DATA_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {SITE_DATA_CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {category === "survey_topo" && (
          <SurveyForm fileName={fileName} onSubmit={onSubmit} onCancel={onCancel} />
        )}
        {category === "geotech" && (
          <GeotechFormView
            fileName={fileName}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
        {category === "meteorological" && (
          <MetFormView fileName={fileName} onSubmit={onSubmit} onCancel={onCancel} />
        )}
        {category === "other" && (
          <OtherFormView
            fileName={fileName}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function useDefaultTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Actions({
  onCancel,
  submitting,
}: {
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <DialogFooter className="mt-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitting}>
        Upload
      </Button>
    </DialogFooter>
  );
}

// --- Survey ---------------------------------------------------------------
function SurveyForm({
  fileName,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  onSubmit: (p: CategoryPayload) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SurveyForm>({
    resolver: zodResolver(surveySchema),
    defaultValues: {
      category: "survey_topo",
      title: useDefaultTitle(fileName),
      units: "m",
      survey_date: "",
      epsg: "",
      surveyor: "",
    },
  });
  const submit = handleSubmit((v) => {
    onSubmit({
      category: "survey_topo",
      title: v.title,
      tags: [`survey:${v.units}`, `epsg:${v.epsg}`],
      metadata: {
        survey_date: v.survey_date,
        epsg: v.epsg,
        surveyor: v.surveyor,
        units: v.units,
      },
    });
  });
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="Title" htmlFor="s-title" error={errors.title?.message}>
        <Input id="s-title" {...register("title")} />
      </Field>
      <Field
        label="Survey date"
        htmlFor="s-date"
        error={errors.survey_date?.message}
      >
        <Input id="s-date" type="date" {...register("survey_date")} />
      </Field>
      <Field label="Coordinate system (EPSG)" htmlFor="s-epsg" error={errors.epsg?.message}>
        <Input id="s-epsg" placeholder="e.g. EPSG:32633" {...register("epsg")} />
      </Field>
      <Field label="Surveyor" htmlFor="s-surveyor" error={errors.surveyor?.message}>
        <Input id="s-surveyor" {...register("surveyor")} />
      </Field>
      <Field label="Units" htmlFor="s-units" error={errors.units?.message}>
        <select
          id="s-units"
          {...register("units")}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="m">meters</option>
          <option value="ft">feet</option>
        </select>
      </Field>
      <Actions onCancel={onCancel} submitting={isSubmitting} />
    </form>
  );
}

// --- Geotech --------------------------------------------------------------
function GeotechFormView({
  fileName,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  onSubmit: (p: CategoryPayload) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GeotechForm>({
    resolver: zodResolver(geotechSchema),
    defaultValues: {
      category: "geotech",
      title: useDefaultTitle(fileName),
      report_number: "",
      lab: "",
      boring_count: 0,
      groundwater_depth_m: 0,
    },
  });
  const submit = handleSubmit((v) => {
    onSubmit({
      category: "geotech",
      title: v.title,
      tags: [`geotech`, `lab:${v.lab}`],
      metadata: {
        report_number: v.report_number,
        lab: v.lab,
        boring_count: v.boring_count,
        groundwater_depth_m: v.groundwater_depth_m,
      },
    });
  });
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="Title" htmlFor="g-title" error={errors.title?.message}>
        <Input id="g-title" {...register("title")} />
      </Field>
      <Field
        label="Report number"
        htmlFor="g-report"
        error={errors.report_number?.message}
      >
        <Input id="g-report" {...register("report_number")} />
      </Field>
      <Field label="Lab" htmlFor="g-lab" error={errors.lab?.message}>
        <Input id="g-lab" {...register("lab")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Boring count"
          htmlFor="g-boring"
          error={errors.boring_count?.message}
        >
          <Input
            id="g-boring"
            type="number"
            min={0}
            step={1}
            {...register("boring_count")}
          />
        </Field>
        <Field
          label="Groundwater depth (m)"
          htmlFor="g-gw"
          error={errors.groundwater_depth_m?.message}
        >
          <Input
            id="g-gw"
            type="number"
            min={0}
            step="0.1"
            {...register("groundwater_depth_m")}
          />
        </Field>
      </div>
      <Actions onCancel={onCancel} submitting={isSubmitting} />
    </form>
  );
}

// --- Meteorological -------------------------------------------------------
function MetFormView({
  fileName,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  onSubmit: (p: CategoryPayload) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MetForm>({
    resolver: zodResolver(metSchema),
    defaultValues: {
      category: "meteorological",
      title: useDefaultTitle(fileName),
      source: "",
      station: "",
      period_start: "",
      period_end: "",
    },
  });
  const submit = handleSubmit((v) => {
    onSubmit({
      category: "meteorological",
      title: v.title,
      tags: [`meteo`, `source:${v.source}`],
      metadata: {
        source: v.source,
        station: v.station,
        period_start: v.period_start,
        period_end: v.period_end,
      },
    });
  });
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="Title" htmlFor="m-title" error={errors.title?.message}>
        <Input id="m-title" {...register("title")} />
      </Field>
      <Field label="Source" htmlFor="m-source" error={errors.source?.message}>
        <Input id="m-source" placeholder="e.g. Meteonorm 8" {...register("source")} />
      </Field>
      <Field label="Station" htmlFor="m-station" error={errors.station?.message}>
        <Input id="m-station" {...register("station")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Period start"
          htmlFor="m-start"
          error={errors.period_start?.message}
        >
          <Input id="m-start" type="date" {...register("period_start")} />
        </Field>
        <Field
          label="Period end"
          htmlFor="m-end"
          error={errors.period_end?.message}
        >
          <Input id="m-end" type="date" {...register("period_end")} />
        </Field>
      </div>
      <Actions onCancel={onCancel} submitting={isSubmitting} />
    </form>
  );
}

// --- Other ----------------------------------------------------------------
function OtherFormView({
  fileName,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  onSubmit: (p: CategoryPayload) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OtherForm>({
    resolver: zodResolver(otherSchema),
    defaultValues: {
      category: "other",
      title: useDefaultTitle(fileName),
      notes: "",
    },
  });
  const submit = handleSubmit((v) => {
    onSubmit({
      category: "other",
      title: v.title,
      tags: [],
      metadata: v.notes ? { notes: v.notes } : {},
    });
  });
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="Title" htmlFor="o-title" error={errors.title?.message}>
        <Input id="o-title" {...register("title")} />
      </Field>
      <Field label="Notes" htmlFor="o-notes" error={errors.notes?.message}>
        <Input id="o-notes" {...register("notes")} />
      </Field>
      <Actions onCancel={onCancel} submitting={isSubmitting} />
    </form>
  );
}
