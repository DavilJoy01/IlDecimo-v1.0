-- supabase/migrations/20260909000000_create_user_profile_and_history_rpcs.sql

-- Reuses the existing public.users_have_mutual_block (defined in
-- 20260830101700_final_review_hardening.sql, already used by
-- search_user_by_code) -- do not redefine it here.

create or replace function public.get_user_profile(target_id uuid)
returns setof public.user_public_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.user_public_profiles p
  where p.id = target_id
    and not public.users_have_mutual_block(auth.uid(), target_id);
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to authenticated;

create or replace function public.get_user_match_history(
  target_id uuid,
  before_date date default null,
  before_time time default null,
  before_id uuid default null,
  page_size int default 20
)
returns table (
  match_id uuid,
  role text,
  outcome text,
  match_type integer,
  field_name text,
  address text,
  match_date date,
  start_time time
)
language sql
stable
security definer
set search_path = ''
as $$
  with history as (
    select
      m.id as match_id,
      'creator'::text as role,
      m.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.matches m
    where m.creator_id = target_id
      and m.status = 'completed'

    union all

    select
      m.id as match_id,
      'participant'::text as role,
      mp.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = target_id
      and mp.status in ('completed', 'left')
      and m.status = 'completed'
  )
  select *
  from history h
  where not public.users_have_mutual_block(auth.uid(), target_id)
    and (
      before_date is null
      or (h.match_date, h.start_time, h.match_id) < (before_date, before_time, before_id)
    )
  order by h.match_date desc, h.start_time desc, h.match_id desc
  limit page_size;
$$;

revoke all on function public.get_user_match_history(uuid, date, time, uuid, int) from public;
grant execute on function public.get_user_match_history(uuid, date, time, uuid, int) to authenticated;
