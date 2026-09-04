-- Add match_message_mention to the allowed notification types
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'join_request_received','join_request_approved','join_request_rejected',
  'friend_request_received','match_invitation','private_message','match_message',
  'match_message_mention','match_reminder','match_time_changed','match_location_changed','match_cancelled'
));
