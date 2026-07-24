
-- P-058: Drawing reviews + minimal notifications

create table if not exists public.drawing_review_rounds (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  revision_id  uuid not null references public.drawing_revisions(id) on delete cascade,
  round_no     int  not null check (round_no >= 1),
  status       text not null default 'open' check (status in ('open','closed','waived')),
  due_date     date,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (revision_id, round_no)
);

create index if not exists idx_drawing_review_rounds_project on public.drawing_review_rounds (project_id);
create index if not exists idx_drawing_review_rounds_revision on public.drawing_review_rounds (revision_id);

grant select, insert, update, delete on public.drawing_review_rounds to authenticated;
grant all on public.drawing_review_rounds to service_role;

alter table public.drawing_review_rounds enable row level security;

create policy "drr_select_company_members"
  on public.drawing_review_rounds for select to authenticated
  using (public.is_company_member(company_id));

create policy "drr_insert_admins"
  on public.drawing_review_rounds for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'engineering_admin')
         or public.has_role(auth.uid(),'project_admin')
         or public.has_role(auth.uid(),'super_admin'))
  );

create policy "drr_update_admins"
  on public.drawing_review_rounds for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'engineering_admin')
         or public.has_role(auth.uid(),'project_admin')
         or public.has_role(auth.uid(),'super_admin'))
  )
  with check (public.is_company_member(company_id));

create trigger set_updated_at_drawing_review_rounds
  before update on public.drawing_review_rounds
  for each row execute function public.set_updated_at();

-- signoffs
create table if not exists public.drawing_review_signoffs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  round_id      uuid not null references public.drawing_review_rounds(id) on delete cascade,
  reviewer_id   uuid not null references public.profiles(id) on delete cascade,
  reviewer_org  text not null check (reviewer_org in ('client','lender','utility','internal')),
  decision      text check (decision in ('approved','approved_with_comments','rejected','waived')),
  comment       text,
  signed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (round_id, reviewer_id)
);

create index if not exists idx_drawing_review_signoffs_round on public.drawing_review_signoffs (round_id);
create index if not exists idx_drawing_review_signoffs_reviewer on public.drawing_review_signoffs (reviewer_id);

grant select, insert, update, delete on public.drawing_review_signoffs to authenticated;
grant all on public.drawing_review_signoffs to service_role;

alter table public.drawing_review_signoffs enable row level security;

create policy "drs_select_company_members"
  on public.drawing_review_signoffs for select to authenticated
  using (public.is_company_member(company_id));

create policy "drs_insert_admins"
  on public.drawing_review_signoffs for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'engineering_admin')
         or public.has_role(auth.uid(),'project_admin')
         or public.has_role(auth.uid(),'super_admin'))
  );

create policy "drs_update_reviewer_or_admin"
  on public.drawing_review_signoffs for update to authenticated
  using (
    public.is_company_member(company_id)
    and (reviewer_id = auth.uid()
         or public.has_role(auth.uid(),'engineering_admin')
         or public.has_role(auth.uid(),'super_admin'))
  )
  with check (public.is_company_member(company_id));

create trigger set_updated_at_drawing_review_signoffs
  before update on public.drawing_review_signoffs
  for each row execute function public.set_updated_at();

-- notifications (minimal — full UI in Batch 12)
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread on public.notifications (user_id, read_at);

grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

alter table public.notifications enable row level security;

create policy "notif_select_own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "notif_update_own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notif_insert_authenticated_company_member"
  on public.notifications for insert to authenticated
  with check (public.is_company_member(company_id));
