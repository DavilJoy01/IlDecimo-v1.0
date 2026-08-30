-- supabase/migrations/20260830100800_create_friendships_table.sql
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  check (requester_id <> receiver_id)
);

create unique index friendships_unique_pair_idx on public.friendships (
  least(requester_id, receiver_id), greatest(requester_id, receiver_id)
);

create or replace function public.enforce_friendship_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requester_id <> old.requester_id then
    raise exception 'requester_id cannot be changed';
  end if;
  if new.receiver_id <> old.receiver_id then
    raise exception 'receiver_id cannot be changed';
  end if;
  if old.status <> 'pending' then
    raise exception 'a friendship decision cannot be changed once made';
  end if;
  if new.status not in ('accepted','rejected') then
    raise exception 'a friendship request can only be accepted or rejected';
  end if;
  if auth.uid() <> old.receiver_id then
    raise exception 'only the receiver can accept or reject a friend request';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_friendship_transition
  before update on public.friendships
  for each row execute function public.enforce_friendship_transition();

create or replace function public.notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester_name text;
begin
  select first_name || ' ' || last_name into v_requester_name
  from public.users where id = new.requester_id;

  insert into public.notifications (user_id, type, payload)
  values (
    new.receiver_id,
    'friend_request_received',
    jsonb_build_object('message', v_requester_name || ' ti ha inviato una richiesta di amicizia', 'friendship_id', new.id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_friend_request
  after insert on public.friendships
  for each row execute function public.notify_on_friend_request();

alter table public.friendships enable row level security;

grant select, insert, update on public.friendships to authenticated;

create policy "friendships_select_participants" on public.friendships
  for select to authenticated using (auth.uid() = requester_id or auth.uid() = receiver_id);

create policy "friendships_insert_as_requester" on public.friendships
  for insert to authenticated with check (auth.uid() = requester_id);

create policy "friendships_update_by_participants" on public.friendships
  for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id)
  with check (auth.uid() = requester_id or auth.uid() = receiver_id);
