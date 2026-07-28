-- P-264 — Full-text search across the document register.

ALTER TABLE public.document_register
  ADD COLUMN IF NOT EXISTS content_text text,
  ADD COLUMN IF NOT EXISTS content_extracted_at timestamptz;

-- Weighted tsvector: A = doc number + title, B = tags + discipline, C = content.
-- 'simple' config (no stemming) so Arabic and English behave predictably;
-- Arabic stemming is not available in Postgres — documented, not faked.
CREATE OR REPLACE FUNCTION public.document_register_tsv(
  p_doc_number text,
  p_title text,
  p_tags text[],
  p_discipline text,
  p_doc_type text,
  p_content text,
  p_file_name text,
  p_metadata jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $fn$
  select setweight(to_tsvector('simple', coalesce(p_doc_number, '') || ' ' || coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('simple',
           coalesce((select string_agg(t, ' ') from unnest(coalesce(p_tags, '{}'::text[])) t), '') || ' ' ||
           coalesce(p_discipline, '') || ' ' || coalesce(p_doc_type, '')), 'B')
      || setweight(to_tsvector('simple',
           left(coalesce(p_content, ''), 200000) || ' ' ||
           coalesce(p_file_name, '') || ' ' ||
           coalesce(p_metadata #>> '{}', '')), 'C');
$fn$;

REVOKE ALL ON FUNCTION public.document_register_tsv(text, text, text[], text, text, text, text, jsonb) FROM PUBLIC, anon;

ALTER TABLE public.document_register
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    public.document_register_tsv(doc_number, title, tags, discipline, doc_type,
                                 content_text, file_name, metadata)
  ) STORED;

CREATE INDEX IF NOT EXISTS document_register_search_idx
  ON public.document_register USING gin (search_vector);

CREATE OR REPLACE FUNCTION public.search_documents(
  p_query text,
  p_project uuid DEFAULT NULL,
  p_doc_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_discipline text DEFAULT NULL,
  p_retention_class text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  doc_number text,
  title text,
  doc_type text,
  discipline text,
  current_revision text,
  status text,
  retention_class text,
  project_id uuid,
  project_name text,
  file_name text,
  has_content boolean,
  updated_at timestamptz,
  rank real,
  snippet text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_ts tsquery;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.is_external_viewer() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select pr.company_id into v_company from public.profiles pr where pr.id = auth.uid();
  if v_company is null then
    raise exception 'no_company' using errcode = '42501';
  end if;

  if length(v_q) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('simple', v_q);
  if v_ts is null or v_ts = ''::tsquery then
    return;
  end if;

  return query
  select d.id,
         d.doc_number,
         d.title,
         d.doc_type,
         d.discipline,
         d.current_revision,
         d.status::text,
         d.retention_class::text,
         d.project_id,
         p.name,
         d.file_name,
         (d.content_text is not null and length(d.content_text) > 0),
         d.updated_at,
         ts_rank(d.search_vector, v_ts)::real,
         ts_headline('simple',
           coalesce(nullif(left(coalesce(d.content_text, ''), 20000), ''), d.title),
           v_ts,
           'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=18,MinWords=5,FragmentDelimiter= … ')
  from public.document_register d
  left join public.projects p on p.id = d.project_id
  where d.company_id = v_company
    and d.search_vector @@ v_ts
    and (p_project is null or d.project_id = p_project)
    and (p_doc_type is null or d.doc_type = p_doc_type)
    and (p_status is null or d.status::text = p_status)
    and (p_discipline is null or d.discipline = p_discipline)
    and (p_retention_class is null or d.retention_class::text = p_retention_class)
    and (p_from is null or d.created_at >= p_from)
    and (p_to is null or d.created_at <= p_to)
  order by ts_rank(d.search_vector, v_ts) desc, d.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

REVOKE ALL ON FUNCTION public.search_documents(text, uuid, text, text, text, text, timestamptz, timestamptz, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_documents(text, uuid, text, text, text, text, timestamptz, timestamptz, int) TO authenticated;