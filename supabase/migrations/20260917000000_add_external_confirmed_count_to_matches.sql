-- supabase/migrations/20260917000000_add_external_confirmed_count_to_matches.sql
--
-- Lets a creator who already has some players lined up outside the app
-- (e.g. "we're already 7, I only need 3 more") say so at creation time,
-- instead of the match starting from 0 and needing every single seat
-- filled through in-app join requests. These people are never real
-- match_participants rows -- they have no account, so there's nothing to
-- store beyond a count -- but they should still count against
-- max_players everywhere "spots left" is computed.
alter table public.matches
  add column external_confirmed_count integer not null default 0
  check (external_confirmed_count >= 0);

alter table public.matches
  add constraint matches_external_confirmed_count_below_max
  check (external_confirmed_count < max_players);

-- Fold external_confirmed_count directly into approved_players_count so
-- every existing client-side "spotsLeft = max_players - approved_players_count"
-- computation (MatchCard, LastCallSection) keeps working with zero changes --
-- this is the single source of truth for "how many seats are already spoken for".
drop function if exists public.nearby_open_matches(double precision, double precision, double precision);

create function public.nearby_open_matches(user_lat double precision, user_lng double precision, radius_km double precision default 20)
returns table(
  id uuid,
  field_name text,
  match_type integer,
  match_date date,
  start_time time,
  end_time time,
  max_players integer,
  distance_km double precision,
  approved_players_count bigint,
  latitude double precision,
  longitude double precision
)
language sql
stable security definer
set search_path to 'extensions'
as $$
  select
    m.id,
    m.field_name,
    m.match_type,
    m.match_date,
    m.start_time,
    m.end_time,
    m.max_players,
    round((ST_Distance(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) / 1000)::numeric, 2)::double precision as distance_km,
    (select count(*) from public.match_participants mp where mp.match_id = m.id and mp.status in ('approved','active')) + m.external_confirmed_count as approved_players_count,
    m.latitude,
    m.longitude
  from public.matches m
  where m.status = 'open'
    and m.creator_id != auth.uid()
    and ST_DWithin(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
  order by distance_km asc;
$$;

grant execute on function public.nearby_open_matches(double precision, double precision, double precision) to authenticated;

revoke execute on function public.nearby_open_matches(double precision, double precision, double precision) from public, anon;
