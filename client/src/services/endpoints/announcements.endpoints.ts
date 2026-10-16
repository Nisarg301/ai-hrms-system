import { callApiServices } from '../callApiServices';
import type { Announcement, AnnouncementPayload } from '../../types/announcement';

export function createAnnouncementRequest(payload: AnnouncementPayload) {
  return callApiServices<Announcement>('/announcements', 'post', true, payload);
}

export function updateAnnouncementRequest(id: string, payload: Partial<AnnouncementPayload>) {
  return callApiServices<Announcement>(`/announcements/${id}`, 'put', true, payload);
}

export function deleteAnnouncementRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/announcements/${id}`, 'delete', true);
}
