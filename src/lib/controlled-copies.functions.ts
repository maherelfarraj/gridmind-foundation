// P-266 — Controlled-copy server functions (issue / recall / queue / completeness).
// All writes go through the guarded definer routines; the table's own RLS keeps
// external viewers out of raw reads.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { CopyStatus } from "@/lib/controlled-copies.rules";

export interface ControlledCopyRow {
  id: string;
  document_id: string;
  copy_number: number;
  revision_pinned: string;
  holder_user_id: string | null;
  holder_contact_id: string | null;
  holder_name: string | null;
  location: string | null;
  issue_date: string;
  status: CopyStatus;
  recall_due_at: string | null;
  recall_reason: string | null;
  recalled_at: string | null;
  returned_at: string | null;
  destroyed_at: string | null;
  notes: string | null;
}

export interface QueueRow {
  id: string;
  document_id: string;
  doc_number: string | null;
  title: string;
  doc_status: string;
  copy_number: number;
  revision_pinned: string;
  holder_name: string | null;
  holder_user_id: string | null;
  holder_contact_id: string | null;
  location: string | null;
  issue_date: string;
  status: CopyStatus;
  recall_due_at: string | null;
  recall_reason: string | null;
}

const COPY_COLUMNS =
  "id, document_id, copy_number, revision_pinned, holder_user_id, holder_contact_id, holder_name, location, issue_date, status, recall_due_at, recall_reason, recalled_at, returned_at, destroyed_at, notes";

export const listDocumentCopies = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ documentId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<ControlledCopyRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("controlled_copies")
      .select(COPY_COLUMNS)
      .eq("document_id", data.documentId)
      .order("copy_number", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as unknown as ControlledCopyRow[];
  });

export const issueControlledCopy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        holderUserId: z.string().uuid().nullable().optional(),
        holderContactId: z.string().uuid().nullable().optional(),
        holderName: z.string().trim().max(160).nullable().optional(),
        location: z.string().trim().max(160).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        issueDate: z.string().nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }): Promise<ControlledCopyRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase.rpc("issue_controlled_copy", {
      p_document_id: data.documentId,
      p_holder_user_id: data.holderUserId ?? undefined,
      p_holder_contact_id: data.holderContactId ?? undefined,
      p_holder_name: data.holderName ?? undefined,
      p_location: data.location ?? undefined,
      p_notes: data.notes ?? undefined,
      p_issue_date: data.issueDate ?? undefined,
    });
    if (error) {
      throw Object.assign(new Error(error.message), { details: error.details });
    }
    return row as unknown as ControlledCopyRow;
  });

export const recallControlledCopy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        copyId: z.string().uuid(),
        disposition: z.enum(["recalled", "returned", "destroyed"]),
        notes: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }): Promise<ControlledCopyRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase.rpc("recall_controlled_copy", {
      p_copy_id: data.copyId,
      p_disposition: data.disposition,
      p_notes: data.notes ?? undefined,
    });
    if (error) throw error;
    return row as unknown as ControlledCopyRow;
  });

export const getControlledCopyQueue = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ onlyDue: z.boolean().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<QueueRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("controlled_copy_queue", {
      p_only_due: data.onlyDue ?? false,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as QueueRow[];
  });
