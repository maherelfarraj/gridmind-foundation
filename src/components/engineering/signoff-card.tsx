// P-053 — Sign-off card for drawings (approval_instances entity='drawing').
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  getMyDrawingRoles,
  listDrawingSignoffs,
} from "@/lib/drawings.functions";
import {
  drawingRolesQueryOptions,
  drawingSignoffsQueryOptions,
  useDecideDrawingSignoff,
  useRequestDrawingSignoff,
} from "@/lib/drawings-query";

interface Props {
  drawingId: string;
  projectId: string;
}

export function SignoffCard({ drawingId, projectId }: Props) {
  const rolesFn = useServerFn(getMyDrawingRoles);
  const signoffsFn = useServerFn(listDrawingSignoffs);
  const { data: roles } = useSuspenseQuery(drawingRolesQueryOptions(rolesFn, projectId));
  const { data: signoffs } = useSuspenseQuery(drawingSignoffsQueryOptions(signoffsFn, drawingId));
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const request = useRequestDrawingSignoff(drawingId);
  const decide = useDecideDrawingSignoff(drawingId);

  const pending = signoffs.find((s) => s.status === "pending");

  return (
    <Card className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          IFD sign-off
        </h3>
        <p className="text-xs text-muted-foreground">
          IFC promotion is blocked until an engineering_admin or project_admin approves.
        </p>
      </header>

      {roles.canWrite && !pending && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="text-xs font-medium text-foreground" htmlFor="signoff-note">
            Request note (optional)
          </label>
          <Textarea
            id="signoff-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="All markups resolved; ready for IFC."
          />
          <div>
            <Button
              size="sm"
              onClick={() => request.mutate({ note: note || null }, { onSuccess: () => setNote("") })}
              disabled={request.isPending}
            >
              Request sign-off
            </Button>
          </div>
        </div>
      )}

      {pending && (
        <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm">
            <Badge className="bg-accent/20 text-accent-foreground border-accent/40">
              Pending
            </Badge>{" "}
            Requested {new Date(pending.created_at).toLocaleString()}
          </p>
          {pending.metadata?.note && (
            <p className="text-xs text-muted-foreground">Note: {pending.metadata.note}</p>
          )}
          {roles.canDecideSignoff && (
            <div className="flex flex-col gap-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Decision comment (optional)"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    decide.mutate(
                      { instanceId: pending.id, decision: "approved", comment: comment || null },
                      { onSuccess: () => setComment("") },
                    )
                  }
                  disabled={decide.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    decide.mutate(
                      { instanceId: pending.id, decision: "rejected", comment: comment || null },
                      { onSuccess: () => setComment("") },
                    )
                  }
                  disabled={decide.isPending}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </p>
        {signoffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sign-offs recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {signoffs.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs"
              >
                <span className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <span className="text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </span>
                {s.decided_at && (
                  <span className="text-muted-foreground">
                    decided {new Date(s.decided_at).toLocaleString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  if (status === "approved")
    return <Badge className="bg-primary/15 text-primary border-primary/40">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}
