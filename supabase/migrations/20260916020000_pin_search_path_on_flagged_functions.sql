-- Supabase's security advisor, run for the first time against the real
-- production project right after the initial `db push` (2026-09-16),
-- flagged `function_search_path_mutable` (WARN) on 4 functions that don't
-- pin their own search_path -- the same class of hardening already applied
-- throughout this schema's SECURITY DEFINER functions (e.g.
-- is_fellow_participant). None of the 4 change behavior here: two
-- (touch_matches_updated_at, tests.clear_authentication/authenticate_as)
-- reference no schema-qualified objects at all, and shuffle_match_teams
-- already fully qualifies every table it touches (public.matches,
-- public.match_participants) and every function call (auth.uid()) --
-- pinning search_path to '' just removes the *possibility* of a future
-- unqualified reference resolving to an attacker-planted object earlier in
-- a mutable search_path. Verified with a full local db reset + the full
-- pgTAP suite (still 204/204 after this migration).
--
-- The advisor's other category of findings -- ~45 SECURITY DEFINER
-- functions "callable" by anon/authenticated -- was checked and is a false
-- positive for all but the legitimate, by-design RPCs (get_user_profile,
-- search_user_by_code, nearby_open_matches, delete_own_account, etc.):
-- every other flagged function returns `trigger`, a type Postgres refuses
-- to invoke outside real trigger execution regardless of any EXECUTE
-- grant, so no code change was needed there. Also confirmed
-- supabase/config.toml's `[api] schemas = ["public", "graphql_public"]`
-- does not expose the `tests` schema at all, so tests.authenticate_as's
-- broad grant (needed for the local pgTAP suite) is unreachable via the
-- Data API regardless of search_path.

create or replace function public.touch_matches_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.shuffle_match_teams(p_match_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_match_type integer;
begin
  select creator_id, match_type into v_creator_id, v_match_type
  from public.matches where id = p_match_id;

  if v_creator_id is null then
    raise exception 'match not found';
  end if;
  if auth.uid() is distinct from v_creator_id then
    raise exception 'only the match creator can shuffle teams';
  end if;

  update public.match_participants
  set team = null
  where match_id = p_match_id and status in ('approved', 'active') and team is not null;

  with shuffled as (
    select id, row_number() over (order by random()) as rn
    from public.match_participants
    where match_id = p_match_id and status in ('approved', 'active')
  )
  update public.match_participants mp
  set team = case
    when shuffled.rn <= v_match_type then 'A'
    when shuffled.rn <= v_match_type * 2 then 'B'
    else null
  end
  from shuffled
  where mp.id = shuffled.id;
end;
$$;

create or replace function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
