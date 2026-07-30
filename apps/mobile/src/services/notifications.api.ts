import { apiFetch } from './api';

export type NotificationDto = {
  id: string;
  user_phone: string | null;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
};

/** First page only; aligns with backend default paging (30 rows). */
const MY_NOTIFICATIONS_QUERY = 'limit=30&page=1';

export async function getMyNotifications(token: string): Promise<NotificationDto[]> {
  return apiFetch<NotificationDto[]>(`/notifications/my?${MY_NOTIFICATIONS_QUERY}`, { token });
}

/**
 * Permanently deletes every notification owned by this user (`DELETE /notifications/my`).
 * Personal rows are hard-deleted from the DB; broadcasts are permanently dismissed for this
 * account only (shared row stays intact for other users). Not reversible.
 */
export async function deleteAllNotifications(
  token: string
): Promise<{ deletedPersonal: number; dismissedBroadcasts: number }> {
  return apiFetch<{ deletedPersonal: number; dismissedBroadcasts: number }>('/notifications/my', {
    method: 'DELETE',
    token,
  });
}
