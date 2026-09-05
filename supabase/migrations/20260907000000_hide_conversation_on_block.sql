-- supabase/migrations/20260907000000_hide_conversation_on_block.sql
alter table public.private_conversations
  add column hidden_for_a_at timestamptz,
  add column hidden_for_b_at timestamptz;

-- Written only by the two triggers below -- no grant/RLS policy lets a
-- client update these directly. Deliberately narrower than a general
-- "archive conversation" feature: the only way a conversation becomes
-- hidden is through blocking, the only way it un-hides is through
-- unblocking. Only the blocker's own side is ever touched, mirroring the
-- friends system's "never reveal a block to the blocked party" principle.
create or replace function public.hide_conversation_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_conversations
  set hidden_for_a_at = case when user_a_id = new.blocker_id then now() else hidden_for_a_at end,
      hidden_for_b_at = case when user_b_id = new.blocker_id then now() else hidden_for_b_at end
  where (user_a_id = new.blocker_id and user_b_id = new.blocked_id)
     or (user_a_id = new.blocked_id and user_b_id = new.blocker_id);
  return new;
end;
$$;

create trigger trg_hide_conversation_on_block
  after insert on public.user_blocks
  for each row execute function public.hide_conversation_on_block();

create or replace function public.unhide_conversation_on_unblock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_conversations
  set hidden_for_a_at = case when user_a_id = old.blocker_id then null else hidden_for_a_at end,
      hidden_for_b_at = case when user_b_id = old.blocker_id then null else hidden_for_b_at end
  where (user_a_id = old.blocker_id and user_b_id = old.blocked_id)
     or (user_a_id = old.blocked_id and user_b_id = old.blocker_id);
  return old;
end;
$$;

create trigger trg_unhide_conversation_on_unblock
  after delete on public.user_blocks
  for each row execute function public.unhide_conversation_on_unblock();
