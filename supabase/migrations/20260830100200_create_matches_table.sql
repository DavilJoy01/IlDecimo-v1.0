create table public.matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  match_type integer not null check (match_type in (5,7,8)),
  field_name text not null,
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location geography(Point,4326) generated always as (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) stored,
  match_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  max_players integer not null check (max_players > 0),
  description text,
  status text not null default 'open' check (status in ('draft','open','full','started','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_location_idx on public.matches using gist (location);

create or replace function public.touch_matches_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_matches_updated_at
  before update on public.matches
  for each row execute function public.touch_matches_updated_at();

alter table public.matches enable row level security;

grant select, insert, update, delete on public.matches to authenticated;

create policy "matches_select_authenticated" on public.matches
  for select to authenticated using (true);

create policy "matches_insert_as_creator" on public.matches
  for insert to authenticated with check (auth.uid() = creator_id);

create policy "matches_update_creator_only" on public.matches
  for update to authenticated using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "matches_delete_creator_only" on public.matches
  for delete to authenticated using (auth.uid() = creator_id);