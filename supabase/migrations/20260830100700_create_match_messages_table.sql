create table public.match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index match_messages_match_id_idx on public.match_messages (match_id, created_at);

alter table public.match_messages enable row level security;

grant select, insert on public.match_messages to authenticated;

create policy "match_messages_select_participants" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
  );

create policy "match_messages_insert_participants" on public.match_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
  );

create or replace function public.notify_on_match_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field_name text;
  v_recipient record;
begin
  select field_name into v_field_name from public.matches where id = new.match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = new.match_id
      and status in ('approved','active')
      and user_id <> new.sender_id
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      'match_message',
      jsonb_build_object('message', 'Nuovo messaggio nella stanza di ' || v_field_name, 'match_id', new.match_id)
    );
  end loop;

  return new;
end;
$$;

create trigger trg_notify_on_match_message
  after insert on public.match_messages
  for each row execute function public.notify_on_match_message();
