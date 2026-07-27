// P-188 — Digital-thread engine. Server-only: never import from client code.
// Resolves the IMPACT_MAP for a change event, writes one impact assessment via
// the guarded RPC, links resolved targets, and notifies module owners.
// Recommendation-only: nothing here mutates a downstream module's records.
import { IMPACT_MAP, type ImpactSpec, type ThreadEvent } from "@/lib/digital-thread/impact-map";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Structurally loose so both the generated and admin clients satisfy it.
type Db = { from: (t: any) => any; rpc: (n: any, a: any) => any };

export interface ThreadContext {
  supabase: Db;
  user?: { id: string } | null;
}

export interface EmitThreadEventInput {
  event: ThreadEvent;
  sourceType: string;
  sourceId: string;
  projectId: string;
  /** Free-form hints from the call site (ids, tags, human summary). */
  payload?: Record<string, unknown>;
}

export interface EmitThreadEventResult {
  assessmentId: string | null;
  impacts: Array<{ area: string; entity_type: string; entity_id: string | null; action: string }>;
  notified: number;
  skipped?: string;
}

function str(payload: Record<string, unknown> | undefined, key: string): string | null {
  const v = payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Every lookup is guarded — a missing table or row yields null, never a throw. */
async function safe<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function latest(
  db: Db,
  table: string,
  projectId: string,
  orderBy = "created_at",
): Promise<string | null> {
  return safe(async () => {
    const { data, error } = await db
      .from(table)
      .select("id")
      .eq("project_id", projectId)
      .order(orderBy, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as { id: string } | null)?.id ?? null;
  });
}

interface ResolveCtx {
  db: Db;
  companyId: string;
  projectId: string;
  payload: Record<string, unknown> | undefined;
  /** Equipment resolved from the alarm chain, cached across resolvers. */
  equipmentId: string | null;
  equipmentTag: string | null;
}

async function alarmEquipment(ctx: ResolveCtx): Promise<string | null> {
  if (ctx.equipmentId !== null) return ctx.equipmentId;
  const direct = str(ctx.payload, "equipmentId");
  if (direct) {
    ctx.equipmentId = direct;
    return direct;
  }
  const scadaAssetId = str(ctx.payload, "scadaAssetId");
  if (!scadaAssetId) return null;
  const row = await safe(async () => {
    const { data } = await ctx.db
      .from("scada_assets")
      .select("equipment_id")
      .eq("id", scadaAssetId)
      .maybeSingle();
    return (data as { equipment_id: string | null } | null) ?? null;
  });
  ctx.equipmentId = row?.equipment_id ?? null;
  return ctx.equipmentId;
}

async function equipmentTagOf(ctx: ResolveCtx): Promise<string | null> {
  if (ctx.equipmentTag) return ctx.equipmentTag;
  const id = await alarmEquipment(ctx);
  if (!id) return null;
  const row = await safe(async () => {
    const { data } = await ctx.db.from("equipment_registry").select("tag").eq("id", id).maybeSingle();
    return (data as { tag: string } | null) ?? null;
  });
  ctx.equipmentTag = row?.tag ?? null;
  return ctx.equipmentTag;
}

async function resolveTarget(spec: ImpactSpec, ctx: ResolveCtx): Promise<string | null> {
  const { db, projectId, payload } = ctx;
  switch (spec.resolver) {
    case "project_self":
      return projectId;
    case "latest_layout":
      return str(payload, "layoutId") ?? (await latest(db, "pv_layouts", projectId));
    case "latest_bom":
      return str(payload, "bomId") ?? (await latest(db, "bom_snapshots", projectId));
    case "latest_simulation":
      return str(payload, "simulationId") ?? (await latest(db, "pv_simulations", projectId));
    case "latest_rfq":
      return str(payload, "rfqId") ?? (await latest(db, "rfqs", projectId));
    case "latest_po":
      return str(payload, "poId") ?? (await latest(db, "purchase_orders", projectId));
    case "latest_sld":
      return str(payload, "sldDrawingId") ?? (await latest(db, "sld_drawings", projectId));
    case "payload_vendor":
      return str(payload, "vendorId");
    case "payload_drawing":
    case "asbuilt_drawing":
      return str(payload, "drawingId") ?? (await latest(db, "drawing_register", projectId));
    case "payload_equipment":
      return str(payload, "equipmentId");
    case "alarm_equipment":
      return alarmEquipment(ctx);
    case "alarm_drawing": {
      const tag = await equipmentTagOf(ctx);
      if (!tag) return null;
      return safe(async () => {
        const { data } = await db
          .from("drawing_register")
          .select("id")
          .eq("project_id", projectId)
          .contains("tags", [tag])
          .limit(1)
          .maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      });
    }
    case "alarm_warranty_claim": {
      const equipmentId = await alarmEquipment(ctx);
      if (!equipmentId) return null;
      return safe(async () => {
        const { data: contracts } = await db
          .from("warranty_contracts")
          .select("id")
          .eq("equipment_id", equipmentId);
        const ids = ((contracts ?? []) as Array<{ id: string }>).map((c) => c.id);
        if (ids.length === 0) return null;
        const { data } = await db
          .from("warranty_claims")
          .select("id")
          .in("warranty_id", ids)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      });
    }
    case "alarm_work_order": {
      const equipmentId = await alarmEquipment(ctx);
      if (!equipmentId) return null;
      return safe(async () => {
        const { data } = await db
          .from("work_orders")
          .select("id")
          .eq("equipment_id", equipmentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      });
    }
    case "alarm_spare_part": {
      const tag = await equipmentTagOf(ctx);
      if (!tag) return null;
      return safe(async () => {
        const { data } = await db
          .from("spare_parts")
          .select("id")
          .ilike("compatible_equipment", `%${tag}%`)
          .limit(1)
          .maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      });
    }
    case "alarm_vendor": {
      const partId = str(payload, "vendorId");
      if (partId) return partId;
      const tag = await equipmentTagOf(ctx);
      if (!tag) return null;
      return safe(async () => {
        const { data } = await db
          .from("spare_parts")
          .select("preferred_vendor_id")
          .ilike("compatible_equipment", `%${tag}%`)
          .limit(1)
          .maybeSingle();
        return (data as { preferred_vendor_id: string | null } | null)?.preferred_vendor_id ?? null;
      });
    }
    default:
      return null;
  }
}

async function notifyOwners(
  db: Db,
  companyId: string,
  roles: string[],
  title: string,
  body: string,
  link: string,
): Promise<number> {
  const users = await safe(async () => {
    const { data } = await db
      .from("user_roles")
      .select("user_id")
      .eq("company_id", companyId)
      .in("role", roles);
    return (data ?? []) as Array<{ user_id: string }>;
  });
  const unique = Array.from(new Set((users ?? []).map((u) => u.user_id)));
  if (unique.length === 0) return 0;
  const ok = await safe(async () => {
    const { error } = await db.from("notifications").insert(
      unique.map((user_id) => ({
        company_id: companyId,
        user_id,
        type: "impact_assessment",
        title,
        body,
        link,
      })),
    );
    return error ? null : true;
  });
  return ok ? unique.length : 0;
}

/**
 * Emit one change event onto the digital thread. Idempotent per open
 * assessment: the RPC returns the existing open assessment for the same
 * (event_type, source) instead of creating a duplicate.
 */
export async function emitThreadEvent(
  context: ThreadContext,
  input: EmitThreadEventInput,
): Promise<EmitThreadEventResult> {
  const db = context.supabase;
  const spec = IMPACT_MAP[input.event];
  if (!spec) return { assessmentId: null, impacts: [], notified: 0, skipped: "unknown_event" };

  const project = await safe(async () => {
    const { data } = await db
      .from("projects")
      .select("id, company_id, name")
      .eq("id", input.projectId)
      .maybeSingle();
    return (data as { id: string; company_id: string; name: string } | null) ?? null;
  });
  if (!project) return { assessmentId: null, impacts: [], notified: 0, skipped: "project_not_found" };

  const ctx: ResolveCtx = {
    db,
    companyId: project.company_id,
    projectId: project.id,
    payload: input.payload,
    equipmentId: null,
    equipmentTag: null,
  };

  const impacts: Array<{
    area: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    link_type: string;
  }> = [];
  for (const s of spec.impacts) {
    const entity_id = await resolveTarget(s, ctx);
    impacts.push({
      area: s.area,
      entity_type: s.entity_type,
      entity_id,
      action: s.action,
      link_type: s.link_type ?? "impacts",
    });
  }

  const summary =
    (typeof input.payload?.summary === "string" ? (input.payload.summary as string) : null) ??
    `${impacts.filter((i) => i.entity_id).length} of ${impacts.length} downstream areas resolved.`;

  const assessmentId = await safe(async () => {
    const { data, error } = await db.rpc("create_impact_assessment", {
      p_event_type: input.event,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_title: `${spec.title} — ${project.name}`,
      p_impacts: impacts.map(({ area, entity_type, entity_id, action }) => ({
        area,
        entity_type,
        entity_id,
        action,
      })),
      p_company_id: project.company_id,
      p_severity: spec.severity,
      p_summary: summary,
      p_metadata: { project_id: project.id, ...(input.payload ?? {}) },
    });
    if (error) return null;
    return (data as string | null) ?? null;
  });

  // Fallback for actorless (service-role) callers: the guarded RPC requires an
  // auth.uid() company membership, so ingestion paths insert directly instead.
  const finalId =
    assessmentId ??
    (await safe(async () => {
      const { data: open } = await db
        .from("impact_assessments")
        .select("id")
        .eq("company_id", project.company_id)
        .eq("event_type", input.event)
        .eq("source_type", input.sourceType)
        .eq("source_id", input.sourceId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      const existing = (open as { id: string } | null)?.id ?? null;
      if (existing) return existing;
      const { data, error } = await db
        .from("impact_assessments")
        .insert({
          company_id: project.company_id,
          project_id: project.id,
          event_type: input.event,
          source_type: input.sourceType,
          source_id: input.sourceId,
          title: `${spec.title} — ${project.name}`,
          summary,
          severity: spec.severity,
          impacts: impacts.map(({ area, entity_type, entity_id, action }) => ({
            area,
            entity_type,
            entity_id,
            action,
          })),
          metadata: { project_id: project.id, ...(input.payload ?? {}) },
        })
        .select("id")
        .single();
      if (error) return null;
      return (data as { id: string }).id;
    }));

  if (!finalId) {
    return {
      assessmentId: null,
      impacts: impacts.map(({ area, entity_type, entity_id, action }) => ({
        area,
        entity_type,
        entity_id,
        action,
      })),
      notified: 0,
      skipped: "assessment_failed",
    };
  }

  // Link the change source directly to each resolved downstream entity so the
  // graph reads correctly from either end.
  for (const i of impacts) {
    if (!i.entity_id) continue;
    const linked = await safe(async () => {
      const { error } = await db.rpc("link_entities", {
        p_source_type: input.sourceType,
        p_source_id: input.sourceId,
        p_link_type: i.link_type,
        p_target_type: i.entity_type,
        p_target_id: i.entity_id,
        p_company_id: project.company_id,
        p_metadata: { project_id: project.id, area: i.area, action: i.action },
      });
      return error ? null : true;
    });
    if (!linked) {
      await safe(async () => {
        await db
          .from("entity_links")
          .upsert(
            {
              company_id: project.company_id,
              project_id: project.id,
              source_type: input.sourceType,
              source_id: input.sourceId,
              link_type: i.link_type,
              target_type: i.entity_type,
              target_id: i.entity_id,
              metadata: { project_id: project.id, area: i.area, action: i.action },
            },
            {
              onConflict: "company_id,source_type,source_id,link_type,target_type,target_id",
              ignoreDuplicates: true,
            },
          );
        return true;
      });
    }
  }

  const roles = Array.from(new Set(spec.impacts.map((s) => s.owner_role)));
  const notified = await notifyOwners(
    db,
    project.company_id,
    roles,
    `${spec.title} — impact assessment`,
    summary,
    `/thread/impact_assessment/${finalId}`,
  );

  return {
    assessmentId: finalId,
    impacts: impacts.map(({ area, entity_type, entity_id, action }) => ({
      area,
      entity_type,
      entity_id,
      action,
    })),
    notified,
  };
}
