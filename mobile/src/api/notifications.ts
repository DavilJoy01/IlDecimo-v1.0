// mobile/src/api/notifications.ts
import { supabase } from './supabase';

export interface AppNotification {
  id: string;
  type: string;
  payload: { message: string; match_id?: string; [key: string]: unknown };
  read_at: string | null;
  created_at: string;
}

// No user_id filter needed here: RLS policy `notifications_select_own`
// already restricts every row to the caller's own notifications.
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notifications').select().order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
