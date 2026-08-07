GRANT EXECUTE ON FUNCTION public.document_history(uuid) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.document_current_in_lineage(uuid) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.issue_controlled_copy(uuid, uuid, uuid, text, text, text, date) TO sandbox_exec;