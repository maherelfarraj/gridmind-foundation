-- GC-07b — Lock down Period Close Cockpit table privileges.
-- The default privileges on this database hand every new public table full
-- rights to anon/authenticated; the cockpit tables must be read-only for
-- users (lifecycle runs through security-definer RPCs) and closed to anon.

REVOKE ALL ON public.costing_checklist_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.costing_checklist_template_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.costing_checklist_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.costing_checklist_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.costing_checklist_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.costing_exceptions FROM PUBLIC, anon, authenticated;

-- Templates are company-admin maintained through RLS-protected direct writes.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costing_checklist_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costing_checklist_template_items TO authenticated;

-- Period artefacts: read-only for users; all writes go through
-- ensure_costing_checklist / update_costing_checklist_item /
-- upsert_costing_exception / resolve_costing_exception.
GRANT SELECT ON public.costing_checklist_runs TO authenticated;
GRANT SELECT ON public.costing_checklist_items TO authenticated;
GRANT SELECT ON public.costing_exceptions TO authenticated;

-- Evidence links may be attached and detached, never rewritten.
GRANT SELECT, INSERT, DELETE ON public.costing_checklist_evidence TO authenticated;

GRANT ALL ON public.costing_checklist_templates TO service_role;
GRANT ALL ON public.costing_checklist_template_items TO service_role;
GRANT ALL ON public.costing_checklist_runs TO service_role;
GRANT ALL ON public.costing_checklist_items TO service_role;
GRANT ALL ON public.costing_checklist_evidence TO service_role;
GRANT ALL ON public.costing_exceptions TO service_role;