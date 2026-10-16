import { callApiServices } from '../callApiServices';
import type { Holiday, HolidayPayload } from '../../types/holiday';

export function listHolidaysRequest(year: number) {
  return callApiServices<Holiday[]>('/holidays', 'get', true, { year });
}

export function createHolidayRequest(payload: HolidayPayload) {
  return callApiServices<Holiday>('/holidays', 'post', true, payload);
}

export function updateHolidayRequest(id: string, payload: Partial<HolidayPayload>) {
  return callApiServices<Holiday>(`/holidays/${id}`, 'put', true, payload);
}

export function deleteHolidayRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/holidays/${id}`, 'delete', true);
}
