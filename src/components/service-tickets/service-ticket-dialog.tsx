// P-109 — Service ticket create/edit dialog.
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTicket,
  listOpenWorkOrders,
  listTicketAssignees,
  listTicketProjects,
} from "@/lib/service-tickets.functions";
import {
  serviceTicketCreateSchema,
  TICKET_CATEGORIES,
  type ServiceTicketCreateInput,
} from "@/lib/service-tickets.rules";
import { WORK_ORDER_PRIORITIES } from "@/lib/work-orders.rules";

interface Props {
  trigger?: React.ReactNode;
  defaultProjectId?: string;
}

export function ServiceTicketDialog({ trigger, defaultProjectId }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const projectsFn = useServerFn(listTicketProjects);
  const assigneesFn = useServerFn(listTicketAssignees);
  const wosFn = useServerFn(listOpenWorkOrders);
  const createFn = useServerFn(createTicket);

  const form = useForm<ServiceTicketCreateInput>({
    resolver: zodResolver(serviceTicketCreateSchema) as never,
    defaultValues: {
      project_id: defaultProjectId ?? "",
      title: "",
      description: "",
      category: "corrective",
      priority: "medium",
      assigned_to: null,
      related_work_order_id: null,
    },
  });

  const projects = useQuery({
    queryKey: ["ticket-projects"],
    queryFn: () => projectsFn(),
    enabled: open,
  });
  const assignees = useQuery({
    queryKey: ["ticket-assignees"],
    queryFn: () => assigneesFn(),
    enabled: open,
  });
  const projectId = form.watch("project_id");
  const workOrders = useQuery({
    queryKey: ["ticket-open-wos", projectId],
    queryFn: () => wosFn({ data: { project_id: projectId } }),
    enabled: !!projectId && open,
  });

  useEffect(() => {
    if (projectId) form.setValue("related_work_order_id", null);
  }, [projectId, form]);

  const mut = useMutation({
    mutationFn: (v: ServiceTicketCreateInput) => createFn({ data: v }),
    onSuccess: (row: { ticket_number: string }) => {
      toast.success(`Created ${row.ticket_number}`);
      qc.invalidateQueries({ queryKey: ["service-tickets"] });
      qc.invalidateQueries({ queryKey: ["breach-log"] });
      setOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to create ticket"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New ticket
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New service ticket</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((v) => mut.mutate(v))}
          >
            <FormField
              control={form.control}
              name="project_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(projects.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Inverter INV-01-01 offline" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TICKET_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {WORK_ORDER_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="assigned_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign to</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— Unassigned —</SelectItem>
                        {(assignees.data ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.full_name ?? a.email ?? a.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="related_work_order_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Related work order</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      disabled={!projectId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {(workOrders.data ?? []).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.wo_number} · {w.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Creating…" : "Create ticket"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
