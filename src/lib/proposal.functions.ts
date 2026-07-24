// P-044 — Proposals versioning RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

const inputSchema = z.object({ proposalId: z.string().uuid() });

/**
 * Create a new draft version of an existing proposal.
 *
 * Copies the source proposal + all line items, bumps `version`, links
 * `previous_version_id`, resets e-sign / lifecycle fields, and marks the
 * source row `superseded`. Writes an audit log so the opportunity timeline
 * can render the event.
 */
export const createProposalVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = requireSupabaseAuth(context);

    // 1. Load source proposal (RLS gates cross-company access).
    const { data: source, error: srcErr } = await supabase
      .from("proposals")
      .select("*")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!source) throw new Error("Proposal not found");

    if (source.status === "superseded" || source.status === "accepted") {
      throw new Error(
        `Cannot version a proposal in status "${source.status}"`,
      );
    }

    // 2. Load line items to copy.
    const { data: lines, error: lineErr } = await supabase
      .from("proposal_line_items")
      .select(
        "sort_order, category, description, qty, unit, unit_price, line_total",
      )
      .eq("proposal_id", source.id)
      .order("sort_order", { ascending: true });
    if (lineErr) throw new Error(lineErr.message);

    // 3. Insert new proposal row (draft, next version, chained).
    const nextVersion = (source.version ?? 1) + 1;
    const { data: created, error: insErr } = await supabase
      .from("proposals")
      .insert({
        company_id: source.company_id,
        opportunity_id: source.opportunity_id,
        project_id: source.project_id,
        title: source.title,
        version: nextVersion,
        previous_version_id: source.id,
        status: "draft",
        currency_code: source.currency_code,
        subtotal: source.subtotal,
        margin_pct: source.margin_pct,
        fx_rate_snapshot: source.fx_rate_snapshot,
        contingency_pct: source.contingency_pct,
        total: source.total,
        valid_until: source.valid_until,
        array_config: source.array_config,
        yield_result: source.yield_result,
        // pricing_lock / e-sign / lifecycle timestamps intentionally reset
        pricing_lock: null,
        esign_provider: null,
        esign_envelope_id: null,
        esign_status: null,
        esign_history: [],
        esign_sent_at: null,
        esign_completed_at: null,
        signed_copy_path: null,
        sent_at: null,
        accepted_at: null,
        notes: source.notes,
        created_by: userId,
      })
      .select("id, version")
      .single();
    if (insErr) throw new Error(insErr.message);

    // 4. Copy line items.
    if (lines && lines.length > 0) {
      const { error: copyErr } = await supabase
        .from("proposal_line_items")
        .insert(
          lines.map((l) => ({
            company_id: source.company_id,
            proposal_id: created.id,
            sort_order: l.sort_order,
            category: l.category,
            description: l.description,
            qty: l.qty,
            unit: l.unit,
            unit_price: l.unit_price,
            line_total: l.line_total,
            created_by: userId,
          })),
        );
      if (copyErr) {
        // best-effort rollback of the new proposal
        await supabase.from("proposals").delete().eq("id", created.id);
        throw new Error(copyErr.message);
      }
    }

    // 5. Mark source as superseded (immutability trigger allows this — only
    //    financial fields are frozen; status is not).
    const { error: supErr } = await supabase
      .from("proposals")
      .update({ status: "superseded" })
      .eq("id", source.id);
    if (supErr) {
      await supabase.from("proposal_line_items").delete().eq("proposal_id", created.id);
      await supabase.from("proposals").delete().eq("id", created.id);
      throw new Error(supErr.message);
    }

    // 6. Audit.
    await supabase.rpc("write_audit_log", {
      p_action: "proposal.version_created",
      p_entity: "proposal",
      p_entity_id: created.id,
      p_metadata: {
        opportunity_id: source.opportunity_id,
        from_version: source.version,
        to_version: created.version,
        previous_proposal_id: source.id,
      },
    });

    return { id: created.id, version: created.version };
  });
