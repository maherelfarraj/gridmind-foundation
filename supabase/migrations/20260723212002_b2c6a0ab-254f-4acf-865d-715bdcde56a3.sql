-- 0008_rate_limit.sql
create table if not exists public.rate_limit_buckets (
  key text primary key,
  tokens numeric not null,
  capacity int not null,
  refill_per_sec numeric not null,
  updated_at timestamptz not null default now()
);

revoke all on public.rate_limit_buckets from public;
revoke all on public.rate_limit_buckets from anon;
revoke all on public.rate_limit_buckets from authenticated;
grant all on public.rate_limit_buckets to service_role;

alter table public.rate_limit_buckets enable row level security;

create or replace function public.consume_rate_limit(
  p_key text,
  p_capacity int,
  p_refill_per_sec numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens numeric;
  v_updated timestamptz;
  v_elapsed numeric;
  v_new_tokens numeric;
begin
  if p_key is null or p_capacity is null or p_capacity <= 0 or p_refill_per_sec is null or p_refill_per_sec < 0 then
    raise exception 'consume_rate_limit: invalid arguments' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets (key, tokens, capacity, refill_per_sec, updated_at)
  values (p_key, p_capacity, p_capacity, p_refill_per_sec, now())
  on conflict (key) do nothing;

  select tokens, updated_at
    into v_tokens, v_updated
  from public.rate_limit_buckets
  where key = p_key
  for update;

  v_elapsed := greatest(0, extract(epoch from (now() - v_updated)));
  v_new_tokens := least(p_capacity::numeric, v_tokens + v_elapsed * p_refill_per_sec);

  if v_new_tokens >= 1 then
    update public.rate_limit_buckets
       set tokens = v_new_tokens - 1,
           capacity = p_capacity,
           refill_per_sec = p_refill_per_sec,
           updated_at = now()
     where key = p_key;
    return true;
  else
    update public.rate_limit_buckets
       set tokens = v_new_tokens,
           capacity = p_capacity,
           refill_per_sec = p_refill_per_sec,
           updated_at = now()
     where key = p_key;
    return false;
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(text, int, numeric) from public;
grant execute on function public.consume_rate_limit(text, int, numeric) to anon;
grant execute on function public.consume_rate_limit(text, int, numeric) to authenticated;
grant execute on function public.consume_rate_limit(text, int, numeric) to service_role;