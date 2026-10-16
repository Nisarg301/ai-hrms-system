import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/setup';
import { API_BASE_URL } from '../../../services/api';
import { makeTestStore } from '../../../test/makeTestStore';
import { dayView } from '../../../test/attendanceFixtures';
import type { AttendanceRequestRow, MonthView } from '../../../types/attendance';
import { AttendanceTab } from './AttendanceTab';

function october(): MonthView {
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
    const dow = new Date(2026, 9, i + 1).getDay();
    if (dow === 0 || dow === 6) return dayView(date, { status: 'weekend' });
    if (date > '2026-10-05') return dayView(date, { status: 'upcoming' });
    return dayView(date, { status: 'absent' });
  });
  days[0] = dayView('2026-10-01', { status: 'present', workedMinutes: 510, late: true, firstIn: '2026-10-01T04:20:00.000Z', lastOut: '2026-10-01T12:50:00.000Z' });
  days[1] = dayView('2026-10-02', { status: 'missing_clock_out', missingClockOut: true, firstIn: '2026-10-02T04:00:00.000Z' });
  days[4] = dayView('2026-10-05', { status: 'in_progress', wfh: true, workedMinutes: 30 });
  return { month: '2026-10', days, totals: { present: 1, halfDay: 0, absent: 0, late: 1, onLeave: 0, averageMinutes: 510 } };
}

function req(id: string, extra: Partial<AttendanceRequestRow>): AttendanceRequestRow {
  return {
    id,
    employeeId: 'u1',
    employeeName: 'Ivy',
    kind: 'wfh',
    startDate: '2026-10-08',
    endDate: '2026-10-09',
    clockIn: null,
    clockOut: null,
    reason: 'Plumber',
    status: 'pending',
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    recordedByName: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    canCancel: true,
    ...extra,
  };
}

let requests: AttendanceRequestRow[];
let monthsAsked: string[];
let posted: unknown[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  monthsAsked = [];
  posted = [];
  requests = [
    req('w1', {}),
    req('f1', { kind: 'regularization', startDate: '2026-09-28', endDate: '2026-09-28', clockIn: '09:30', clockOut: '18:00', status: 'approved', canCancel: false, recordedByName: 'Ann Admin' }),
  ];
  const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
  server.use(
    http.get(`${API_BASE_URL}/attendance/me`, ({ request }) => {
      const month = new URL(request.url).searchParams.get('month')!;
      monthsAsked.push(month);
      return ok(month === '2026-10' ? october() : { month, days: [dayView(`${month}-01`, { status: 'absent' })], totals: { present: 0, halfDay: 0, absent: 1, late: 0, onLeave: 0, averageMinutes: 0 } });
    }),
    http.get(`${API_BASE_URL}/attendance/requests/mine`, () => ok(requests)),
    http.post(`${API_BASE_URL}/attendance/requests/:id/cancel`, ({ params }) => {
      const r = requests.find((x) => x.id === params.id)!;
      Object.assign(r, { status: 'cancelled', canCancel: false });
      return ok(r);
    }),
    http.post(`${API_BASE_URL}/attendance/requests`, async ({ request }) => {
      posted.push(await request.json());
      return ok({ id: 'new' }, 201);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function renderTab() {
  render(
    <Provider store={makeTestStore()}>
      <AttendanceTab />
    </Provider>
  );
}

describe('Me → Attendance', () => {
  it('shows the month as a calendar with statuses, marks and totals', async () => {
    renderTab();
    expect(await screen.findByTestId('month-grid')).toBeInTheDocument();
    expect(screen.getByTestId('shown-month')).toHaveTextContent('October 2026');
    expect(screen.getByLabelText('1 October: Present, late')).toHaveTextContent('8h 30m');
    expect(screen.getByLabelText('2 October: Missing clock-out')).toBeInTheDocument();
    expect(screen.getByLabelText('3 October: Weekend')).toBeInTheDocument();
    expect(screen.getByLabelText('5 October: In progress, WFH')).toBeInTheDocument();
    expect(screen.getByText('Average day').closest('.ant-card')).toHaveTextContent('8h 30m');
    // Next month is in the future.
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(monthsAsked).toContain('2026-09'));
    expect(screen.getByTestId('shown-month')).toHaveTextContent('September 2026');
  });

  it('opens a day and asks to fix it, with the date filled in', async () => {
    renderTab();
    await userEvent.click(await screen.findByLabelText('2 October: Missing clock-out'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText("You didn't clock out this day, so it counts no hours until it's fixed.")).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /request a fix for this day/i }));
    expect(await screen.findByText('Request an attendance fix')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveValue('02 Oct 2026');
  });

  it("doesn't offer a fix for a day that hasn't happened", async () => {
    renderTab();
    await userEvent.click(await screen.findByLabelText('6 October: Upcoming'));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /request a fix for this day/i })).not.toBeInTheDocument();
  });

  it("shows days before I joined as such, with nothing to fix", async () => {
    server.use(
      http.get(`${API_BASE_URL}/attendance/me`, () => {
        const m = october();
        m.days[0] = dayView('2026-10-01', { status: 'not_joined' });
        return HttpResponse.json({ success: true, data: m });
      })
    );
    renderTab();
    await userEvent.click(await screen.findByLabelText('1 October: Not joined yet'));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /request a fix for this day/i })).not.toBeInTheDocument();
  });

  it('lists my requests and cancels a pending one', async () => {
    renderTab();
    expect(await screen.findByText('Work from home')).toBeInTheDocument();
    expect(screen.getByText('Recorded by Ann Admin')).toBeInTheDocument();
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels).toHaveLength(1);
    await userEvent.click(cancels[0]);
    const confirm = (await screen.findAllByText('Cancel this request?')).at(-1)!.closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('opens the WFH form', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /request wfh/i }));
    expect(await screen.findByText('Request work from home')).toBeInTheDocument();
  });
});
