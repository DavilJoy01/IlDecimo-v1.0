-- Supabase's performance advisor, run against the real production project
-- right after the initial `db push` (2026-09-16), flagged 10 foreign key
-- columns with no covering index (INFO) -- Postgres doesn't create one
-- automatically for foreign keys the way it does for primary/unique keys,
-- so a join or an ON DELETE CASCADE check on any of these has to scan the
-- whole table. Purely additive, no behavior change; safe to add before the
-- app has real traffic rather than waiting for it to become a measured
-- problem.

create index match_invitations_inviter_id_idx on public.match_invitations (inviter_id);
create index match_message_mentions_mentioned_user_id_idx on public.match_message_mentions (mentioned_user_id);
create index match_messages_sender_id_idx on public.match_messages (sender_id);
create index private_conversations_user_a_id_idx on public.private_conversations (user_a_id);
create index private_conversations_user_b_id_idx on public.private_conversations (user_b_id);
create index private_messages_sender_id_idx on public.private_messages (sender_id);
create index reports_reported_match_id_idx on public.reports (reported_match_id);
create index reports_reported_user_id_idx on public.reports (reported_user_id);
create index reports_reporter_id_idx on public.reports (reporter_id);
create index user_blocks_blocked_id_idx on public.user_blocks (blocked_id);
