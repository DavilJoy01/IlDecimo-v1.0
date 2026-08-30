create table public.private_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);

create unique index private_conversations_unique_pair_idx on public.private_conversations (
  least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
);

alter table public.private_conversations enable row level security;

grant select, insert on public.private_conversations to authenticated;

create policy "private_conversations_select_participants" on public.private_conversations
  for select to authenticated using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "private_conversations_insert_participant_no_block" on public.private_conversations
  for insert to authenticated with check (
    (auth.uid() = user_a_id or auth.uid() = user_b_id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = user_a_id and b.blocked_id = user_b_id)
         or (b.blocker_id = user_b_id and b.blocked_id = user_a_id)
    )
  );

create table public.private_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index private_messages_conversation_id_idx on public.private_messages (conversation_id, created_at);

alter table public.private_messages enable row level security;

grant select, insert, update on public.private_messages to authenticated;

create policy "private_messages_select_participants" on public.private_messages
  for select to authenticated using (
    exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "private_messages_insert_participant_no_block" on public.private_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = c.user_a_id and b.blocked_id = c.user_b_id)
             or (b.blocker_id = c.user_b_id and b.blocked_id = c.user_a_id)
        )
    )
  );

create policy "private_messages_update_read_receipt" on public.private_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
    and sender_id is distinct from auth.uid()
  )
  with check (true);

create or replace function public.protect_private_message_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at or new.body <> old.body or new.sender_id <> old.sender_id or new.conversation_id <> old.conversation_id then
    raise exception 'only read_at can be updated on a private message';
  end if;
  return new;
end;
$$;

create trigger trg_protect_private_message_immutable_fields
  before update on public.private_messages
  for each row execute function public.protect_private_message_immutable_fields();

create or replace function public.notify_on_private_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_sender_name text;
begin
  select case when user_a_id = new.sender_id then user_b_id else user_a_id end
  into v_recipient_id
  from public.private_conversations where id = new.conversation_id;

  select first_name into v_sender_name from public.users where id = new.sender_id;

  insert into public.notifications (user_id, type, payload)
  values (
    v_recipient_id,
    'private_message',
    jsonb_build_object('message', 'Nuovo messaggio da ' || v_sender_name, 'conversation_id', new.conversation_id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_private_message
  after insert on public.private_messages
  for each row execute function public.notify_on_private_message();
