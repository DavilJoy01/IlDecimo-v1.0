-- supabase/migrations/20260830101100_create_match_invitations_table.sql
create table public.match_invitations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent','viewed','ignored')),
  created_at timestamptz not null default now(),
  unique (match_id, invitee_id),
  check (inviter_id <> invitee_id)
);

alter table public.match_invitations enable row level security;

grant select, insert, update on public.match_invitations to authenticated;

create policy "match_invitations_select_participants" on public.match_invitations
  for select to authenticated using (auth.uid() = inviter_id or auth.uid() = invitee_id);

create policy "match_invitations_insert_as_inviter" on public.match_invitations
  for insert to authenticated with check (auth.uid() = inviter_id);

create policy "match_invitations_update_as_invitee" on public.match_invitations
  for update to authenticated using (auth.uid() = invitee_id) with check (auth.uid() = invitee_id);

create or replace function public.notify_on_match_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_name text;
  v_field_name text;
begin
  select first_name into v_inviter_name from public.users where id = new.inviter_id;
  select field_name into v_field_name from public.matches where id = new.match_id;

  insert into public.notifications (user_id, type, payload)
  values (
    new.invitee_id,
    'match_invitation',
    jsonb_build_object('message', v_inviter_name || ' ti ha invitato a partecipare a una partita a ' || v_field_name, 'match_id', new.match_id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_match_invitation
  after insert on public.match_invitations
  for each row execute function public.notify_on_match_invitation();
