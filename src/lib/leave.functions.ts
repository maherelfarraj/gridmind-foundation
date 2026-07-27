// P-230 — Leave management server functions. Thin wrappers only: helpers live
// in leave.server.ts and the pure lib src/lib/timesheets/leave.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  applyBalance,
  createLeaveEntries,
  findOverlaps,
  LEAVE_APPROVER_ROLES,
  LEAVE_COLS,
  LEAVE_UNWIND_ROLES,
  loadLeave,
  notifyUsers,
  readBalance,
  removeLeaveEntries,
  roleHolderIds,
  serverDays,
  type LeaveRow,
} from "@/lib/leave.server";
import {
  currentCompanyId,
  hasAnyRole,
  httpError,
  writeAuditLog,
} from "@/lib/timesheets.server";
import {
  isInsideLeavePrefix,
  leaveAttachmentPath,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  summariseBalance,
  validateLeaveFile,
  type LeaveType,
} from "@/lib/timesheets/leave";

const BUCKET = "documents";
const SIGNED_URL_TTL = 300;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const leaveTypeSchema = z.enum(LEAVE_TYPES as unknown as [string, ...string[]]);

export interface LeaveOverview {
  me: { id: string; company_id: string };
  isApprover: boolean;
  canUnwind: boolean;
  myRequests: LeaveRow[];
  pending: LeaveRow[];
  people: Record<string, string>;
  balance: ReturnType<typeof summariseBalance>;
  approvedThisYear: Array<{ leave_type: string; days: number; request_number: string | null }>;
}

export const getLeaveOverview = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<LeaveOverview> => {
    requireSupabaseAuth(context);
    const db = context.supabase;
    const userId = context.user!.id;
    const companyId = await currentCompanyId(db, userId);
    const isApprover = await hasAnyRole(db, LEAVE_APPROVER_ROLES);
    const canUnwind = await hasAnyRole(db, LEAVE_UNWIND_ROLES);

    const mine = await db
      .from("leave_requests")
      .select(LEAVE_COLS)
      .eq("user_id", userId)
      .order("date_from", { ascending: false })
      .limit(60);
    if (mine.error) throw mine.error;

    let pending: LeaveRow[] = [];
    if (isApprover) {
      const res = await db
        .from("leave_requests")
        .select(LEAVE_COLS)
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(100);
      if (res.error) throw res.error;
      pending = res.data as unknown as LeaveRow[];
    }

    const myRequests = mine.data as unknown as LeaveRow[];
    const ids = [...new Set([...myRequests, ...pending].map((r) => r.user_id))];
    const people: Record<string, string> = {};
    if (ids.length) {
      const prof = await db.from("profiles").select("id, full_name, email").in("id", ids);
      for (const p of (prof.data ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
      }>) {
        people[p.id] = p.full_name || p.email || "Team member";
      }
    }

    const year = new Date().getUTCFullYear();
    const approvedThisYear = myRequests
      .filter((r) => r.status === "approved" && r.date_from.startsWith(String(year)))
      .map((r) => ({
        leave_type: r.leave_type,
        days: Number(r.days),
        request_number: r.request_number,
      }));

    return {
      me: { id: userId, company_id: companyId },
      isApprover,
      canUnwind,
      myRequests,
      pending,
      people,
      balance: summariseBalance(await readBalance(db, companyId, userId)),
      approvedThisYear,
    };
  });

/** Live day count preview — always recomputed on the server. */
export const previewLeaveDays = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ date_from: isoDate, date_to: isoDate }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ days: number }> => {
    requireSupabaseAuth(context);
    return { days: serverDays(data.date_from, data.date_to) };
  });

export const requestLeave = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        leave_type: leaveTypeSchema,
        date_from: isoDate,
        date_to: isoDate,
        reason: z.string().trim().max(2000).optional().nullable(),
      })
      .refine((v) => v.date_to >= v.date_from, { message: "End date must not precede start date" })
      .parse(raw),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ leave: LeaveRow; days: number; pendingOverlapWarning: string | null }> => {
      requireSupabaseAuth(context);
      const db = context.supabase;
      const userId = context.user!.id;
      const companyId = await currentCompanyId(db, userId);

      // Days are ALWAYS recomputed server-side; any client value is ignored.
      const days = serverDays(data.date_from, data.date_to);

      const overlaps = await findOverlaps(db, userId, data.date_from, data.date_to);
      if (overlaps.approved) {
        httpError(
          409,
          "leave_overlap",
          `An approved ${overlaps.approved.request_number ?? "leave request"} already covers these dates`,
        );
      }

      const inserted = await db
        .from("leave_requests")
        .insert({
          company_id: companyId,
          user_id: userId,
          leave_type: data.leave_type as never,
          date_from: data.date_from,
          date_to: data.date_to,
          days,
          reason: data.reason?.trim() || null,
          status: "pending" as never,
        })
        .select(LEAVE_COLS)
        .single();

      if (inserted.error) {
        if (inserted.error.code === "23505") {
          httpError(
            409,
            "leave_duplicate",
            "You already have a request of this type for exactly these dates.",
          );
        }
        throw inserted.error;
      }
      const leave = inserted.data as unknown as LeaveRow;

      await writeAuditLog(db, "leave.requested", "leave_requests", leave.id, {
        leave_number: leave.request_number,
        leave_type: leave.leave_type,
        date_from: leave.date_from,
        date_to: leave.date_to,
        days,
      });

      const approvers = await roleHolderIds(db, companyId, [
        "foreman",
        "construction_admin",
        "project_admin",
      ]);
      await notifyUsers(db, companyId, approvers, {
        type: "leave.requested",
        title: `Leave request ${leave.request_number ?? ""}`.trim(),
        body: `${LEAVE_TYPE_LABELS[leave.leave_type]} — ${days} working days (${leave.date_from} → ${leave.date_to}).`,
        link: "/timesheets/leave",
      });

      return {
        leave,
        days,
        pendingOverlapWarning: overlaps.pending.length
          ? `Heads up: ${overlaps.pending.map((p) => p.request_number ?? "a pending request").join(", ")} also covers part of these dates.`
          : null,
      };
    },
  );

export const createLeaveAttachmentUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        leave_request_id: z.string().uuid(),
        filename: z.string().trim().min(1).max(200),
        mimeType: z.string().min(1).max(160),
        size: z.number().int().positive(),
      })
      .parse(raw),
  )
  .handler(
    async ({ context, data }): Promise<{ path: string; token: string; bucket: string }> => {
      requireSupabaseAuth(context);
      const db = context.supabase;
      const userId = context.user!.id;
      const leave = await loadLeave(db, data.leave_request_id);
      if (leave.user_id !== userId) httpError(403, "forbidden");
      const bad = validateLeaveFile({ size: data.size, type: data.mimeType });
      if (bad) httpError(400, bad);

      const path = leaveAttachmentPath(leave.company_id, userId, leave.id, data.filename);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: signed, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error || !signed) httpError(400, "upload_url_failed");
      return { path, token: signed!.token, bucket: BUCKET };
    },
  );

export const attachLeaveDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ leave_request_id: z.string().uuid(), path: z.string().min(1).max(600) }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const db = context.supabase;
    const leave = await loadLeave(db, data.leave_request_id);
    if (leave.user_id !== context.user!.id) httpError(403, "forbidden");
    if (!isInsideLeavePrefix(data.path, leave.company_id)) httpError(403, "invalid_file_path");
    const { error } = await db
      .from("leave_requests")
      .update({ attachment_path: data.path })
      .eq("id", leave.id);
    if (error) throw error;
    return { ok: true };
  });

export const signLeaveAttachment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ leave_request_id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const db = context.supabase;
    const leave = await loadLeave(db, data.leave_request_id);
    if (!leave.attachment_path) return { url: null };
    if (!isInsideLeavePrefix(leave.attachment_path, leave.company_id)) {
      httpError(403, "invalid_file_path");
    }
    // RLS on the row already limited visibility to the owner and approvers.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(leave.attachment_path, SIGNED_URL_TTL);
    if (error) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

export const decideLeave = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        leave_request_id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().trim().max(2000).optional().nullable(),
      })
      .refine((v) => v.decision !== "rejected" || !!v.comment?.trim(), {
        message: "A comment is required when rejecting",
        path: ["comment"],
      })
      .parse(raw),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ status: string; days: number; skipped_weeks: string[]; entries_created: number }> => {
      requireSupabaseAuth(context);
      const db = context.supabase;
      const userId = context.user!.id;
      if (!(await hasAnyRole(db, LEAVE_APPROVER_ROLES))) httpError(403, "forbidden");

      const leave = await loadLeave(db, data.leave_request_id);
      if (leave.status !== "pending") {
        httpError(409, "leave_not_pending", `This request is already ${leave.status}.`);
      }

      // Guarded transition: only the row still in `pending` is updated, so a
      // double-click can never increment the balance twice.
      const updated = await db
        .from("leave_requests")
        .update({
          status: data.decision as never,
          approver_id: userId,
          decided_at: new Date().toISOString(),
          decision_comment: data.comment?.trim() || null,
        })
        .eq("id", leave.id)
        .eq("status", "pending" as never)
        .select(LEAVE_COLS)
        .maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) httpError(409, "leave_not_pending", "This request was already decided.");
      const row = updated.data as unknown as LeaveRow;

      let skipped: string[] = [];
      let createdCount = 0;
      if (data.decision === "approved") {
        await applyBalance(
          db,
          row.company_id,
          row.user_id,
          row.leave_type as LeaveType,
          Number(row.days),
        );
        const auto = await createLeaveEntries(db, row);
        skipped = auto.skipped_weeks;
        createdCount = auto.created;
      }

      await writeAuditLog(db, "leave.decided", "leave_requests", row.id, {
        leave_number: row.request_number,
        decision: data.decision,
        days: Number(row.days),
        entries_created: createdCount,
        skipped_weeks: skipped,
      });

      await notifyUsers(db, row.company_id, [row.user_id], {
        type: `leave.${data.decision}`,
        title: `Leave ${data.decision}: ${row.request_number ?? ""}`.trim(),
        body:
          data.decision === "approved"
            ? `${Number(row.days)} working days approved (${row.date_from} → ${row.date_to}).`
            : `Rejected — ${data.comment?.trim()}`,
        link: "/timesheets/leave",
      });

      return {
        status: data.decision,
        days: Number(row.days),
        skipped_weeks: skipped,
        entries_created: createdCount,
      };
    },
  );

export const cancelLeave = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ leave_request_id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<{ status: "cancelled" }> => {
    requireSupabaseAuth(context);
    const db = context.supabase;
    const leave = await loadLeave(db, data.leave_request_id);
    if (leave.user_id !== context.user!.id) httpError(403, "forbidden");
    if (leave.status !== "pending") {
      httpError(
        409,
        "leave_not_pending",
        "Approved leave can only be withdrawn by a project or company admin.",
      );
    }
    const { error } = await db
      .from("leave_requests")
      .update({ status: "cancelled" as never })
      .eq("id", leave.id)
      .eq("status", "pending" as never);
    if (error) throw error;
    await writeAuditLog(db, "leave.cancelled", "leave_requests", leave.id, {
      leave_number: leave.request_number,
    });
    return { status: "cancelled" };
  });

/** Admin unwind of an APPROVED request: reverses the balance and the entries. */
export const withdrawApprovedLeave = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ leave_request_id: z.string().uuid(), comment: z.string().trim().min(1).max(2000) })
      .parse(raw),
  )
  .handler(
    async ({ context, data }): Promise<{ removed: number; skipped_weeks: string[] }> => {
      requireSupabaseAuth(context);
      const db = context.supabase;
      if (!(await hasAnyRole(db, LEAVE_UNWIND_ROLES))) httpError(403, "forbidden");
      const leave = await loadLeave(db, data.leave_request_id);
      if (leave.status !== "approved") httpError(409, "leave_not_approved");

      const undo = await removeLeaveEntries(db, leave);
      await applyBalance(
        db,
        leave.company_id,
        leave.user_id,
        leave.leave_type as LeaveType,
        -Number(leave.days),
      );
      const { error } = await db
        .from("leave_requests")
        .update({ status: "cancelled" as never, decision_comment: data.comment })
        .eq("id", leave.id)
        .eq("status", "approved" as never);
      if (error) throw error;

      await writeAuditLog(db, "leave.cancelled", "leave_requests", leave.id, {
        leave_number: leave.request_number,
        by: "admin",
        entries_removed: undo.removed,
        skipped_weeks: undo.skipped_weeks,
      });
      await notifyUsers(db, leave.company_id, [leave.user_id], {
        type: "leave.cancelled",
        title: `Leave withdrawn: ${leave.request_number ?? ""}`.trim(),
        body: data.comment,
        link: "/timesheets/leave",
      });
      return undo;
    },
  );
