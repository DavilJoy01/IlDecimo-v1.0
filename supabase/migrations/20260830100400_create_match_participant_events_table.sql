create table public.match_participant_events (
  id uuid primary key default gen_random_uuid(),
  match_participant_id uuid not null references public.match_participants(id) on delete cascade,
  from_status text,
  to_status text not null,
  -- Use clock_timestamp() instead of now() to ensure each insert/update gets a distinct timestamp
  -- within the same transaction, even in rapid succession. now() returns transaction start time.
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.match_participant_events enable row level security;

grant select on public.match_participant_events to authenticated;

create policy "participant_events_select_relevant" on public.match_participant_events
  for select to authenticated using (
    -- The participant themselves
    auth.uid() = (select user_id from public.match_participants where id = match_participant_id)
    -- OR the match creator
    or auth.uid() = (select creator_id from public.matches where id = (select match_id from public.match_participants where id = match_participant_id))
    -- OR a fellow approved/active/completed participant in the same match
    or public.is_fellow_participant((select match_id from public.match_participants where id = match_participant_id), auth.uid())
  );

create or replace function public.log_participant_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.match_participant_events (match_participant_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    insert into public.match_participant_events (match_participant_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger trg_log_participant_status_change
  after insert or update on public.match_participants
  for each row execute function public.log_participant_status_change();
