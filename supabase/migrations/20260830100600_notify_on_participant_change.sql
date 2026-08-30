-- supabase/migrations/20260830100600_notify_on_participant_change.sql
create or replace function public.notify_on_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_field_name text;
begin
  select creator_id, field_name into v_creator_id, v_field_name
  from public.matches where id = new.match_id;

  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, payload)
    values (
      v_creator_id,
      'join_request_received',
      jsonb_build_object(
        'message', 'Hai ricevuto una nuova richiesta di partecipazione per ' || v_field_name,
        'match_id', new.match_id,
        'participant_user_id', new.user_id
      )
    );
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'requested' then
    insert into public.notifications (user_id, type, payload)
    values (
      new.user_id,
      'join_request_approved',
      jsonb_build_object('message', 'La tua richiesta per ' || v_field_name || ' è stata approvata', 'match_id', new.match_id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status = 'requested' then
    insert into public.notifications (user_id, type, payload)
    values (
      new.user_id,
      'join_request_rejected',
      jsonb_build_object('message', 'La tua richiesta per ' || v_field_name || ' è stata rifiutata', 'match_id', new.match_id)
    );
  end if;

  return new;
end;
$$;

create trigger trg_notify_on_participant_change
  after insert or update on public.match_participants
  for each row execute function public.notify_on_participant_change();
