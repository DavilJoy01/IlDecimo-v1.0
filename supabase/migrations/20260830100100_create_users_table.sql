-- supabase/migrations/20260830100100_create_users_table.sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  unique_user_id text unique,
  phone text unique not null,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  height_cm integer not null check (height_cm > 0 and height_cm < 250),
  preferred_foot text not null check (preferred_foot in ('left','right','both')),
  player_role text not null check (player_role in ('player','goalkeeper','both')),
  profile_image_url text,
  matches_played_count integer not null default 0,
  matches_completed_count integer not null default 0,
  matches_abandoned_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.user_id_seq start 100000;

create or replace function public.generate_unique_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.unique_user_id is not null then
    raise exception 'unique_user_id cannot be set manually';
  end if;
  new.unique_user_id := 'FC-' || lpad(nextval('public.user_id_seq')::text, 6, '0');
  return new;
end;
$$;

create trigger trg_generate_unique_user_id
  before insert on public.users
  for each row execute function public.generate_unique_user_id();

create or replace function public.protect_users_row()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.unique_user_id is distinct from old.unique_user_id then
    raise exception 'unique_user_id is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_protect_users_row
  before update on public.users
  for each row execute function public.protect_users_row();

alter table public.users enable row level security;

grant select, insert, update on public.users to authenticated;

create policy "users_select_authenticated" on public.users
  for select to authenticated using (true);

create policy "users_insert_self" on public.users
  for insert to authenticated with check (auth.uid() = id);

create policy "users_update_self" on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
