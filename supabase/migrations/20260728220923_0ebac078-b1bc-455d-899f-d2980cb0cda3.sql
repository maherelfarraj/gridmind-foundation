-- 0104_document_supersedure.sql — P-265: supersedure chains + version compare.

alter table public.document_register
  add column if not exists change_summary text,
  add column if not exists supersedes_id uuid references public.document_register(id) on delete set null;

create unique index if not exists document_register_supersedes_unique
  on public.document_register (supersedes_id) where supersedes_id is not null;

alter table public.document_register
  drop constraint if exists document_register_no_self_supersedes;
alter table public.document_register
  add constraint document_register_no_self_supersedes
  check (supersedes_id is null or supersedes_id <> id);

-- ------------------------------------------------- guard (derived doctrine)
create or replace function public.document_register_supersede_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marked boolean := coalesce(current_setting('gridmind.derived_status', true), 'off') = 'on';
  v_parent public.document_register%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select * into v_parent from public.document_register where id = new.supersedes_id;
      if v_parent.id is null or v_parent.company_id is distinct from new.company_id then
        raise exception 'document_supersedes_cross_tenant' using errcode = '42501';
      end if;
      if coalesce(btrim(new.change_summary), '') = '' then
        raise exception 'document_change_summary_required'
          using errcode = '23514',
                hint = 'A new revision must carry a change summary.';
      end if;
      if v_parent.status = 'obsolete'::public.document_register_status then
        raise exception 'document_supersedes_obsolete' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if not v_marked then
    if new.superseded_by_id is distinct from old.superseded_by_id then
      raise exception 'document_supersedure_is_derived'
        using errcode = '42501',
              hint = 'superseded_by_id is maintained by registering a new revision.';
    end if;
    if new.status is distinct from old.status
       and 'superseded'::public.document_register_status in (new.status, old.status) then
      raise exception 'document_supersedure_is_derived'
        using errcode = '42501',
              hint = 'The superseded state is derived from the revision chain.';
    end if;
    if new.supersedes_id is distinct from old.supersedes_id then
      raise exception 'document_supersedure_is_derived'
        using errcode = '42501',
              hint = 'The link to the previous revision is immutable.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists document_register_supersede_guard_trg on public.document_register;
create trigger document_register_supersede_guard_trg
  before insert or update on public.document_register
  for each row execute function public.document_register_supersede_guard();

-- ------------------------------------------------------- auto-supersede
create or replace function public.document_register_auto_supersede()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supersedes_id is null then
    return new;
  end if;
  perform set_config('gridmind.derived_status', 'on', true);
  update public.document_register
     set status = 'superseded'::public.document_register_status,
         superseded_by_id = new.id,
         updated_at = now()
   where id = new.supersedes_id
     and status <> 'obsolete'::public.document_register_status;
  perform set_config('gridmind.derived_status', 'off', true);
  return new;
end $$;

drop trigger if exists document_register_auto_supersede_trg on public.document_register;
create trigger document_register_auto_supersede_trg
  after insert on public.document_register
  for each row execute function public.document_register_auto_supersede();

-- ------------------------------------------------------------------- RPCs
create or replace function public.document_history(p_doc_id uuid)
returns table (
  id uuid,
  doc_number text,
  title text,
  current_revision text,
  status public.document_register_status,
  discipline text,
  change_summary text,
  supersedes_id uuid,
  superseded_by_id uuid,
  owner_id uuid,
  owner_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  depth integer,
  is_root boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.document_register d where d.id = p_doc_id;
  if v_company is null then return; end if;
  if not public.is_company_member(v_company) or public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  with recursive up as (
    select d.*, 0 as lvl from public.document_register d where d.id = p_doc_id
    union all
    select p.*, u.lvl - 1
      from public.document_register p
      join up u on p.id = u.supersedes_id
     where p.company_id = v_company
  ),
  down as (
    select d.*, 0 as lvl from public.document_register d where d.id = p_doc_id
    union all
    select c.*, dn.lvl + 1
      from public.document_register c
      join down dn on c.id = dn.superseded_by_id
     where c.company_id = v_company
  ),
  chain as (
    select * from up union select * from down
  ),
  ranked as (
    select c.*, row_number() over (order by c.lvl, c.created_at) as seq,
           min(c.lvl) over () as min_lvl
      from chain c
  )
  select r.id, r.doc_number, r.title, r.current_revision, r.status, r.discipline,
         r.change_summary, r.supersedes_id, r.superseded_by_id,
         r.owner_id, o.full_name, r.created_by, a.full_name,
         r.created_at, r.updated_at,
         (r.seq - 1)::integer, (r.lvl = r.min_lvl) as is_root
    from ranked r
    left join public.profiles o on o.id = r.owner_id
    left join public.profiles a on a.id = r.created_by
   order by r.seq;
end $$;

create or replace function public.document_current_in_lineage(p_doc_id uuid)
returns table (
  id uuid,
  doc_number text,
  title text,
  current_revision text,
  status public.document_register_status,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_id uuid := p_doc_id;
  v_next uuid;
  v_guard integer := 0;
begin
  select company_id into v_company from public.document_register d where d.id = p_doc_id;
  if v_company is null then return; end if;
  if not public.is_company_member(v_company) or public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  loop
    select d.superseded_by_id into v_next from public.document_register d where d.id = v_id;
    exit when v_next is null or v_guard > 200;
    v_id := v_next;
    v_guard := v_guard + 1;
  end loop;

  return query
  select d.id, d.doc_number, d.title, d.current_revision, d.status, (d.id = p_doc_id)
    from public.document_register d
   where d.id = v_id;
end $$;

revoke all on function public.document_register_supersede_guard() from public, anon, authenticated;
revoke all on function public.document_register_auto_supersede() from public, anon, authenticated;
revoke all on function public.document_history(uuid) from public, anon;
revoke all on function public.document_current_in_lineage(uuid) from public, anon;
grant execute on function public.document_history(uuid) to authenticated;
grant execute on function public.document_current_in_lineage(uuid) to authenticated;