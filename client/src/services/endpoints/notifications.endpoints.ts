import { callApiServices } from '../callApiServices';
import type { AppNotification } from '../../types/notification';

export function listNotificationsRequest(limit = 20) {
  return callApiServices<{ items: AppNotification[]; unreadCount: number }>('/notifications', 'get', true, { limit });
}

export function getUnreadCountRequest() {
  return callApiServices<{ count: number }>('/notifications/unread-count', 'get', true);
}

export function markNotificationReadRequest(id: string) {
  return callApiServices<AppNotification>(`/notifications/${id}/read`, 'post', true);
}

export function markAllNotificationsReadRequest() {
  return callApiServices<{ updated: number }>('/notifications/read-all', 'post', true);
}
