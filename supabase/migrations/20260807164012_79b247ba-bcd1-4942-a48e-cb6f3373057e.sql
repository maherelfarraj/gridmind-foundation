-- GC-12d — EVM trigger routines are internal only: no direct EXECUTE for
-- anon, PUBLIC or authenticated. Triggers fire as the table owner regardless.
REVOKE EXECUTE ON FUNCTION public.evm_reports_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evm_mapping_versions_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evm_append_only_guard() FROM PUBLIC, anon, authenticated;