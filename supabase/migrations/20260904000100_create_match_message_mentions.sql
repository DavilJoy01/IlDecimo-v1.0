-- supabase/migrations/20260904000100_create_match_message_mentions.sql
create table public.match_message_mentions (
  message_id uuid not null references public.match_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  primary key (message_id, mentioned_user_id)
);

alter table public.match_message_mentions enable row level security;
grant select, insert on public.match_message_mentions to authenticated;
revoke all on public.match_message_mentions from public, anon;

create policy "match_message_mentions_select_participants" on public.match_message_mentions
  for select to authenticated using (
    exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id
        and (
          exists (
            select 1 from public.match_participants mp
            where mp.match_id = mm.match_id and mp.user_id = auth.uid()
              and mp.status in ('approved','active','completed')
          )
          or auth.uid() = (select creator_id from public.matches where id = mm.match_id)
        )
    )
  );

create policy "match_message_mentions_insert_own_message" on public.match_message_mentions
  for insert to authenticated with check (
    mentioned_user_id <> auth.uid()
    and exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id and mm.sender_id = auth.uid()
    )
  );

-- Never trust the client to only send valid mention targets: reject any
-- mention of someone who isn't the match's creator or an approved/active
-- participant. Runs inside the same transaction as send_match_message's
-- insert (Task 3), so an invalid mention rolls back the whole send, not just
-- the bad mention row -- deliberate, see that migration's comment.
create or replace function public.enforce_valid_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_creator_id uuid;
  v_is_valid boolean;
begin
  select match_id into v_match_id from public.match_messages where id = new.message_id;
  select creator_id into v_creator_id from public.matches where id = v_match_id;

  if new.mentioned_user_id = v_creator_id then
    v_is_valid := true;
  else
    select exists(
      select 1 from public.match_participants
      where match_id = v_match_id
        and user_id = new.mentioned_user_id
        and status in ('approved','active')
    ) into v_is_valid;
  end if;

  if not v_is_valid then
    raise exception 'cannot mention a user who is not the creator or an approved/active participant of this match';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_valid_mention
  before insert on public.match_message_mentions
  for each row execute function public.enforce_valid_mention();
