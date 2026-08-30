create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in (
    'join_request_received','join_request_approved','join_request_rejected',
    'friend_request_received','match_invitation','private_message','match_message',
    'match_reminder','match_time_changed','match_location_changed','match_cancelled'
  )),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

grant select, update on public.notifications to authenticated;

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

create policy "notifications_update_own" on public.notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

alter table public.user_push_tokens enable row level security;

grant select, insert, delete on public.user_push_tokens to authenticated;

create policy "user_push_tokens_select_own" on public.user_push_tokens
  for select to authenticated using (auth.uid() = user_id);

create policy "user_push_tokens_insert_own" on public.user_push_tokens
  for insert to authenticated with check (auth.uid() = user_id);

create policy "user_push_tokens_delete_own" on public.user_push_tokens
  for delete to authenticated using (auth.uid() = user_id);
