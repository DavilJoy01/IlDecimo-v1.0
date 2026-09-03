-- supabase/migrations/20260903000000_exclude_own_matches_from_nearby.sql
-- "Partite vicino a te" should only surface matches created by other users —
-- a match's own creator already sees it under "Le mie partite" and joining
-- your own match makes no sense.
create or replace function public.nearby_open_matches(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 20
)
returns table (
  id uuid,
  field_name text,
  match_type integer,
  match_date date,
  start_time time,
  end_time time,
  max_players integer,
  distance_km double precision,
  approved_players_count bigint
)
language sql
stable
security definer
set search_path = 'extensions'
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
    (select count(*) from public.match_participants mp where mp.match_id = m.id and mp.status in ('approved','active')) as approved_players_count
  from public.matches m
  where m.status = 'open'
    and m.creator_id != auth.uid()
    and ST_DWithin(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
  order by distance_km asc;
$$;
