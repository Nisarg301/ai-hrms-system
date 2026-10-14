import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '../services/api';
import type { DayView, TodayView } from '../types/attendance';

export const SCHEDULE = { shiftStart: '09:30', shiftEnd: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240 };

export function dayView(date: string, extra: Partial<DayView> = {}): DayView {
  return {
    date,
    status: 'not_in_yet',
    workedMinutes: 0,
    firstIn: null,
    lastOut: null,
    late: false,
    wfh: false,
    leave: null,
    holidayName: null,
    missingClockOut: false,
    ...extra,
  };
}

/** The clock card's data: not clocked in yet, unless overridden. */
export function todayView(extra: Partial<TodayView> = {}): TodayView {
  return {
    date: '2026-10-05',
    now: '2026-10-05T04:30:00.000Z',
    schedule: SCHEDULE,
    day: dayView('2026-10-05'),
    punches: [],
    clockedIn: false,
    clockedInSince: null,
    canClockIn: true,
    cannotClockInReason: null,
    canClockOut: false,
    ...extra,
  };
}

/** Handlers for things every page now loads in passing: Home's clock, expenses, onboarding and performance cards, the admin badge (leave, attendance, expenses), the notifications bell. */
export const attendanceBackground = [
  http.get(`${API_BASE_URL}/expenses/mine`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/expenses/pending-count`, () => HttpResponse.json({ success: true, data: { count: 0 } })),
  http.get(`${API_BASE_URL}/lifecycle/mine`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/lifecycle/tasks/assigned-to-me`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/reviews/mine`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/reviews/to-write`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/goals/mine`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${API_BASE_URL}/notifications/unread-count`, () => HttpResponse.json({ success: true, data: { count: 0 } })),
  http.get(`${API_BASE_URL}/attendance/today`, () => HttpResponse.json({ success: true, data: todayView() })),
  http.get(`${API_BASE_URL}/attendance/pending-count`, () => HttpResponse.json({ success: true, data: { regularization: 0, wfh: 0, total: 0 } })),
];
