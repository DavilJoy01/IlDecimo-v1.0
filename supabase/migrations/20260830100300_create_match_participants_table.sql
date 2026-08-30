create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('requested','approved','rejected','active','left','completed')),
  join_count integer not null default 1,
  leave_count integer not null default 0,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  left_at timestamptz,
  unique (match_id, user_id)
);

create or replace function public.enforce_participant_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select creator_id into v_creator_id from public.matches where id = coalesce(new.match_id, old.match_id);

  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'a new participation must start as requested';
    end if;
    if new.user_id <> auth.uid() then
      raise exception 'a user can only request participation for themselves';
    end if;
    new.join_count := 1;
    new.leave_count := 0;
    new.requested_at := now();
    return new;
  end if;

  if new.status = 'requested' and old.status = 'left' then
    if auth.uid() <> old.user_id then
      raise exception 'only the participant themselves can re-request to join';
    end if;
    if old.leave_count >= 2 then
      raise exception 'maximum number of re-entries (2) reached for this match';
    end if;
    new.join_count := old.join_count + 1;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;

  elsif new.status in ('approved','rejected') and old.status = 'requested' then
    if auth.uid() <> v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;

  elsif new.status = 'active' and old.status = 'approved' then
    null;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() <> old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();

  elsif new.status = 'completed' and old.status in ('approved','active') then
    null;

  else
    raise exception 'invalid participation status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_participant_state_machine
  before insert or update on public.match_participants
  for each row execute function public.enforce_participant_state_machine();

alter table public.match_participants enable row level security;

grant select, insert, update on public.match_participants to authenticated;

create policy "participants_select_authenticated" on public.match_participants
  for select to authenticated using (true);

create policy "participants_insert_self" on public.match_participants
  for insert to authenticated with check (auth.uid() = user_id);

create policy "participants_update_self_or_creator" on public.match_participants
  for update to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
  )
  with check (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
  );
