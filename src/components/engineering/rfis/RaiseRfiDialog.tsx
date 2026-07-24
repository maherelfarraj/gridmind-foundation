// P-059 — Raise RFI dialog.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listRoutableMembers } from "@/lib/rfi.functions";
import { routableMembersQueryOptions, useRaiseRfi } from "@/lib/rfi-query";

const DISCIPLINES = [
  "civil",
  "structural",
  "electrical",
  "mechanical",
  "scada_controls",
  "survey",
  "general",
] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const schema = z.object({
  subject: z.string().min(3, "Min 3 characters").max(140),
  question: z.string().min(10, "Min 10 characters").max(4000),
  discipline: z.enum(DISCIPLINES),
  priority: z.enum(PRIORITIES),
  routedTo: z.string().uuid("Select a reviewer"),
  dueDate: z.date(),
  costImpact: z.boolean().optional(),
  scheduleImpact: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export function RaiseRfiDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Raise RFI</Button>
      </DialogTrigger>
      {open && (
        <Inner projectId={projectId} onDone={() => setOpen(false)} />
      )}
    </Dialog>
  );
}

function Inner({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const membersFn = useServerFn(listRoutableMembers);
  const { data: members } = useSuspenseQuery(
    routableMembersQueryOptions(membersFn, projectId),
  );
  const raise = useRaiseRfi(projectId);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      subject: "",
      question: "",
      discipline: "general",
      priority: "normal",
      routedTo: "",
      dueDate: addDays(new Date(), 7),
      costImpact: false,
      scheduleImpact: false,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await raise.mutateAsync({
      subject: values.subject,
      question: values.question,
      discipline: values.discipline,
      priority: values.priority,
      routedTo: values.routedTo,
      dueDate: format(values.dueDate, "yyyy-MM-dd"),
      costImpact: values.costImpact,
      scheduleImpact: values.scheduleImpact,
    });
    onDone();
  });

  const dueDate = form.watch("dueDate");

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Raise RFI</DialogTitle>
        <DialogDescription>
          Route a question to a project member. Number is assigned automatically.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="rfi-subject">Subject</Label>
          <Input id="rfi-subject" {...form.register("subject")} />
          {form.formState.errors.subject && (
            <p className="mt-1 text-xs text-destructive">
              {form.formState.errors.subject.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="rfi-question">Question</Label>
          <Textarea
            id="rfi-question"
            rows={4}
            {...form.register("question")}
          />
          {form.formState.errors.question && (
            <p className="mt-1 text-xs text-destructive">
              {form.formState.errors.question.message}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Discipline</Label>
            <Select
              value={form.watch("discipline")}
              onValueChange={(v) =>
                form.setValue("discipline", v as (typeof DISCIPLINES)[number])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCIPLINES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority</Label>
            <Select
              value={form.watch("priority")}
              onValueChange={(v) =>
                form.setValue("priority", v as (typeof PRIORITIES)[number])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Route to</Label>
          <Select
            value={form.watch("routedTo")}
            onValueChange={(v) => form.setValue("routedTo", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a reviewer" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.routedTo && (
            <p className="mt-1 text-xs text-destructive">
              {form.formState.errors.routedTo.message}
            </p>
          )}
        </div>
        <div>
          <Label>Due date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !dueDate && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dueDate ? format(dueDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dueDate}
                onSelect={(d) => d && form.setValue("dueDate", d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...form.register("costImpact")}
              className="accent-primary"
            />
            Cost impact
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...form.register("scheduleImpact")}
              className="accent-primary"
            />
            Schedule impact
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={raise.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={raise.isPending}>
            {raise.isPending ? "Raising…" : "Raise RFI"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
