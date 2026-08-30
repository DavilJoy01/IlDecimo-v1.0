create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

grant select, insert, delete on public.user_blocks to authenticated;

create policy "user_blocks_select_own" on public.user_blocks
  for select to authenticated using (auth.uid() = blocker_id);

create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated with check (auth.uid() = blocker_id);

create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated using (auth.uid() = blocker_id);
