// mobile/src/hooks/useNotifications.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchNotifications, markNotificationRead, type AppNotification } from '@/api/notifications';

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotifications();
      setNotifications(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le notifiche.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string): Promise<void> {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch {
      // Best-effort: a failed mark-as-read isn't worth surfacing as a user
      // facing error -- the notification just stays unread until the next
      // manual refresh, which is a harmless, self-correcting outcome.
    }
  }

  const unreadCount = notifications.filter((n) => n.read_at === null).length;

  return { notifications, unreadCount, loading, error, markRead, refresh: load };
}
