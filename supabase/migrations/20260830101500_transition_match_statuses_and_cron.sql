alter table public.matches add column reminder_sent_at timestamptz;

create or replace function public.transition_match_statuses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_participant record;
begin
  for v_match in
    select id, field_name from public.matches
    where status in ('open','full')
      and reminder_sent_at is null
      and (match_date + start_time)::timestamptz <= now() + interval '1 hour'
      and (match_date + start_time)::timestamptz > now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      insert into public.notifications (user_id, type, payload)
      values (
        v_participant.user_id,
        'match_reminder',
        jsonb_build_object('message', 'La tua partita a ' || v_match.field_name || ' inizia tra meno di un''ora', 'match_id', v_match.id)
      );
    end loop;

    update public.matches set reminder_sent_at = now() where id = v_match.id;
  end loop;

  update public.matches
  set status = 'started'
  where status in ('open','full')
    and (match_date + start_time)::timestamptz <= now();

  for v_match in
    select id from public.matches
    where status = 'started'
      and (match_date + end_time)::timestamptz <= now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      update public.match_participants
      set status = 'completed'
      where match_id = v_match.id and user_id = v_participant.user_id;

      update public.users
      set matches_completed_count = matches_completed_count + 1
      where id = v_participant.user_id;
    end loop;

    update public.matches set status = 'completed' where id = v_match.id;
  end loop;
end;
$$;

-- Supabase's default ACL (see Task 14) grants EXECUTE on every new public-schema
-- function to authenticated/anon by default. This function is system-only -- it
-- should run only via the pg_cron job below (which executes as a superuser and
-- bypasses grants entirely) -- so revoke both roles' default access explicitly;
-- an ordinary signed-in user must never be able to force match completions or
-- reminders on demand by calling this directly.
revoke execute on function public.transition_match_statuses() from public, authenticated, anon;

select cron.schedule(
  'transition-match-statuses',
  '* * * * *',
  $$ select public.transition_match_statuses(); $$
);
