create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid references public.users(id) on delete cascade,
  reported_match_id uuid references public.matches(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  check (reported_user_id is not null or reported_match_id is not null)
);

alter table public.reports enable row level security;

grant select, insert on public.reports to authenticated;

create policy "reports_select_own" on public.reports
  for select to authenticated using (auth.uid() = reporter_id);

create policy "reports_insert_own" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);
