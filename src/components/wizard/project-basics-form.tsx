// P-034 — Project basics form (wizard step 2).
import { format } from "date-fns";
import { CalendarIcon, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  makeProjectBasicsSchema,
  suggestProjectCode,
  type ProjectBasics,
} from "@/lib/schemas/project-wizard";
import type { ProjectArchetype } from "@/lib/wizard-draft";

type Props = {
  archetype: ProjectArchetype;
  defaultValues?: Partial<ProjectBasics>;
  onSubmit: (values: ProjectBasics) => void;
  onBack: () => void;
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

export function ProjectBasicsForm({
  archetype,
  defaultValues,
  onSubmit,
  onBack,
}: Props) {
  const needsMwh =
    archetype === "standalone_bess" || archetype === "hybrid_pv_bess";

  const form = useForm<ProjectBasics>({
    resolver: zodResolver(makeProjectBasicsSchema(archetype)),
    mode: "onChange",
    defaultValues: {
      name: "",
      code: "",
      capacity_mw: undefined as unknown as number,
      capacity_mwh: undefined,
      site_name: "",
      site_country: "",
      site_region: "",
      site_lat: undefined,
      site_lng: undefined,
      offtaker: "",
      target_cod: undefined as unknown as Date,
      ...defaultValues,
    },
  });

  // Auto-suggest project code from name until the user edits code manually.
  const codeTouched = useRef<boolean>(
    Boolean(defaultValues?.code && defaultValues.code.length > 0),
  );
  const name = form.watch("name");
  useEffect(() => {
    if (codeTouched.current) return;
    if (!name || name.trim().length === 0) return;
    form.setValue("code", suggestProjectCode(name), {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [name, form]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        <Card className="flex flex-col gap-8 border-border bg-card p-6">
          {/* Identity */}
          <section className="flex flex-col gap-4">
            <SectionHeader>Identity</SectionHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Prairie Winds Solar"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="PWS-2026"
                      {...field}
                      onChange={(e) => {
                        codeTouched.current = true;
                        field.onChange(e.target.value.toUpperCase());
                      }}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    2–12 chars: A-Z, 0-9, hyphen. Auto-suggested from the name.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {/* Capacity */}
          <section className="flex flex-col gap-4">
            <SectionHeader>Capacity</SectionHeader>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="capacity_mw"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity (MW)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          className="pr-12"
                          {...field}
                          value={field.value ?? ""}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                          MW
                        </span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {needsMwh ? (
                <FormField
                  control={form.control}
                  name="capacity_mwh"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Energy capacity (MWh)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min={0}
                            className="pr-12"
                            {...field}
                            value={field.value ?? ""}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                            MWh
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </div>
          </section>

          {/* Site */}
          <section className="flex flex-col gap-4">
            <SectionHeader>Site</SectionHeader>
            <FormField
              control={form.control}
              name="site_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Site name</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="site_country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="site_region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Region / state</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="site_lat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Latitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="-90 to 90"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="site_lng"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Longitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="-180 to 180"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button type="button" variant="outline" disabled>
                      <MapPin size={16} aria-hidden />
                      Pick on map
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Map picker ships in a later batch
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </section>

          {/* Commercial */}
          <section className="flex flex-col gap-4">
            <SectionHeader>Commercial</SectionHeader>
            <FormField
              control={form.control}
              name="offtaker"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offtaker</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Utility or corporate PPA counterparty"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="target_cod"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Target COD</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "w-[260px] justify-start text-left font-normal",
                            !field.value && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon size={16} aria-hidden />
                          {field.value
                            ? format(field.value, "PPP")
                            : "Pick a date"}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={(d) => field.onChange(d)}
                        disabled={(d) => d.getTime() <= Date.now()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>
        </Card>

        <footer className="flex items-center justify-between border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={!form.formState.isValid}>
            Next
          </Button>
        </footer>
      </form>
    </Form>
  );
}
