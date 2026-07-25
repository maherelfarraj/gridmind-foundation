import { useState } from "react";
import { Mail, Phone, Plus, Star, Trash2, UserRound } from "lucide-react";

import { ContactDialog } from "@/components/crm/detail/ContactDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContactRow } from "@/lib/opportunity.functions";
import { useDeleteContact } from "@/lib/opportunity-query";

interface Props {
  opportunityId: string;
  contacts: ContactRow[] | undefined;
  isLoading: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export function ContactsCard({ opportunityId, contacts, isLoading, canWrite, canDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const del = useDeleteContact(opportunityId);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: ContactRow) => {
    setEditing(c);
    setOpen(true);
  };

  return (
    <Card className="flex flex-col gap-3 border-border bg-card p-5">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground">Contacts</h2>
          <p className="text-xs text-muted-foreground">Buyer decision-makers on this deal</p>
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus size={14} aria-hidden />
            Add
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !contacts || contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No contacts yet
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <div className="mt-0.5">
                {c.is_primary ? (
                  <Star size={14} aria-label="Primary" className="fill-primary text-primary" />
                ) : (
                  <UserRound size={14} className="text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => canWrite && openEdit(c)}
                    className="truncate text-sm font-medium text-foreground disabled:cursor-default"
                  >
                    {c.full_name}
                  </button>
                  {c.title && (
                    <Badge variant="secondary" className="text-[10px]">
                      {c.title}
                    </Badge>
                  )}
                  {c.is_primary && <Badge className="text-[10px]">Primary</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Mail size={11} aria-hidden />
                      {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={11} aria-hidden />
                      {c.phone}
                    </span>
                  )}
                </div>
              </div>
              {canDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (
                      typeof window !== "undefined" &&
                      window.confirm(`Delete contact "${c.full_name}"?`)
                    ) {
                      del.mutate(c.id);
                    }
                  }}
                  aria-label={`Delete ${c.full_name}`}
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        open={open}
        onOpenChange={setOpen}
        opportunityId={opportunityId}
        existing={editing}
      />
    </Card>
  );
}
