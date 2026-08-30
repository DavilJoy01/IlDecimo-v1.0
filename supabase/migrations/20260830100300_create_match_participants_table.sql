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
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'a new participation must start as requested';
    end if;
    if new.user_id is distinct from auth.uid() then
      raise exception 'a user can only request participation for themselves';
    end if;
    new.join_count := 1;
    new.leave_count := 0;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;
    return new;
  end if;

  -- UPDATE: the row's identity is never caller-writable, in either direction.
  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;

  select creator_id into v_creator_id from public.matches where id = old.match_id;

  -- Every derived/audit column defaults to its current value; only the
  -- specific branch below that legitimately changes one is allowed to.
  -- This closes the gap where a caller's UPDATE statement could set these
  -- columns directly alongside a status change the trigger does approve.
  new.join_count := old.join_count;
  new.leave_count := old.leave_count;
  new.requested_at := old.requested_at;
  new.approved_at := old.approved_at;
  new.left_at := old.left_at;

  if new.status = 'requested' and old.status = 'left' then
    if auth.uid() is distinct from old.user_id then
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
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;

  elsif new.status = 'active' and old.status = 'approved' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can activate a participant';
    end if;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();

  elsif new.status = 'completed' and old.status in ('approved','active') then
    if auth.uid() is not null and auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator or the system can mark a participation completed';
    end if;

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

-- security definer + set search_path = '' so this helper's internal query
-- runs as the function owner (table owner), which is exempt from RLS.
-- Without this, the exists() check below would need to re-evaluate the
-- very select policy it's called from, and Postgres detects that cycle
-- and raises "infinite recursion detected in policy for relation ...".
create or replace function public.is_fellow_participant(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.match_participants mp2
    where mp2.match_id = p_match_id
      and mp2.user_id = p_user_id
      and mp2.status in ('approved','active','completed')
  );
$$;

create policy "participants_select_relevant" on public.match_participants
  for select to authenticated using (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
    or public.is_fellow_participant(match_id, auth.uid())
  );

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
