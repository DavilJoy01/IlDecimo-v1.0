-- supabase/migrations/20260910000000_add_match_participant_teams.sql

alter table public.match_participants
  add column team text check (team in ('A', 'B'));

create or replace function public.enforce_participant_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_match_type integer;
  v_team_count integer;
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
    new.team := null;
    return new;
  end if;

  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;

  select creator_id into v_creator_id from public.matches where id = old.match_id;

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
    new.team := old.team;

  elsif new.status in ('approved','rejected') and old.status = 'requested' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;
    new.team := old.team;

  elsif new.status = 'active' and old.status = 'approved' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can activate a participant';
    end if;
    new.team := old.team;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();
    new.team := null;

  elsif new.status = 'completed' and old.status in ('approved','active') then
    if auth.uid() is not null and auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator or the system can mark a participation completed';
    end if;
    new.team := old.team;

  elsif new.status = old.status then
    if new.team is distinct from old.team then
      if auth.uid() is distinct from v_creator_id then
        raise exception 'only the match creator can assign a team';
      end if;
      if old.status not in ('approved', 'active') then
        raise exception 'only an approved or active participant can be assigned a team';
      end if;
      if new.team is not null then
        select match_type into v_match_type from public.matches where id = old.match_id;
        select count(*) into v_team_count
        from public.match_participants
        where match_id = old.match_id and team = new.team and id <> old.id;
        if v_team_count >= v_match_type then
          raise exception 'team % is already full', new.team;
        end if;
      end if;
    end if;

  else
    raise exception 'invalid participation status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create or replace function public.shuffle_match_teams(p_match_id uuid)
returns void
language plpgsql
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

revoke all on function public.shuffle_match_teams(uuid) from public;
grant execute on function public.shuffle_match_teams(uuid) to authenticated;
