-- supabase/migrations/20260830101400_notify_on_match_lifecycle_change.sql
create or replace function public.notify_on_match_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant record;
  v_message text;
  v_type text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    v_message := 'La partita a ' || new.field_name || ' è stata cancellata';
    v_type := 'match_cancelled';
  elsif new.start_time <> old.start_time or new.end_time <> old.end_time or new.match_date <> old.match_date then
    v_message := 'L''orario della partita a ' || new.field_name || ' è cambiato';
    v_type := 'match_time_changed';
  elsif new.address <> old.address then
    v_message := 'Il luogo della partita è cambiato: ' || new.field_name;
    v_type := 'match_location_changed';
  else
    return new;
  end if;

  for v_participant in
    select user_id from public.match_participants
    where match_id = new.id and status in ('approved','active')
  loop
    insert into public.notifications (user_id, type, payload)
    values (v_participant.user_id, v_type, jsonb_build_object('message', v_message, 'match_id', new.id));
  end loop;

  return new;
end;
$$;

create trigger trg_notify_on_match_lifecycle_change
  after update on public.matches
  for each row execute function public.notify_on_match_lifecycle_change();
