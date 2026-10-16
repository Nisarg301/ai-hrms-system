import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { dayView, todayView } from '../../test/attendanceFixtures';
import type { TodayView } from '../../types/attendance';
import { ClockCard } from './ClockCard';

let state: TodayView;
let calls: string[];

beforeEach(() => {
  state = todayView();
  calls = [];
  const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
  server.use(
    http.get(`${API_BASE_URL}/attendance/today`, () => {
      calls.push('today');
      return ok(state);
    }),
    http.post(`${API_BASE_URL}/attendance/clock-in`, () => {
      calls.push('in');
      if (state.clockedIn) return HttpResponse.json({ success: false, error: { message: "You're already clocked in" } }, { status: 409 });
      state = todayView({
        clockedIn: true,
        clockedInSince: '2026-10-05T04:10:00.000Z',
        canClockIn: false,
        cannotClockInReason: "You're already clocked in",
        canClockOut: true,
        day: dayView('2026-10-05', { status: 'in_progress', late: true, firstIn: '2026-10-05T04:10:00.000Z' }),
        punches: [{ id: 'p1', clockIn: '2026-10-05T04:10:00.000Z', clockOut: null, source: 'web' }],
      });
      return ok(state, 201);
    }),
    http.post(`${API_BASE_URL}/attendance/clock-out`, () => {
      calls.push('out');
      state = todayView({
        day: dayView('2026-10-05', { status: 'present', workedMinutes: 495, late: true, lastOut: '2026-10-05T12:25:00.000Z' }),
        punches: [{ id: 'p1', clockIn: '2026-10-05T04:10:00.000Z', clockOut: '2026-10-05T12:25:00.000Z', source: 'web' }],
      });
      return ok(state);
    })
  );
});

function renderCard() {
  render(
    <Provider store={makeTestStore()}>
      <MemoryRouter>
        <ClockCard />
      </MemoryRouter>
    </Provider>
  );
}

describe('ClockCard', () => {
  it('clocks in, shows the time since, then clocks out', async () => {
    renderCard();
    expect(await screen.findByText('You haven’t clocked in today.')).toBeInTheDocument();
    expect(screen.getByText('Shift 09:30–18:30')).toBeInTheDocument();
    expect(screen.getByText('Not in yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My attendance' })).toHaveAttribute('href', '/me/attendance');

    await userEvent.click(screen.getByRole('button', { name: /clock in/i }));
    expect(await screen.findByText('Clocked in. Have a good day!')).toBeInTheDocument();
    expect(screen.getByTestId('clock-summary')).toHaveTextContent(/In since \d\d:\d\d · 0m today/);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Late')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /clock out/i }));
    await waitFor(() => expect(screen.getByTestId('clock-summary')).toHaveTextContent('8h 15m today · last out'));
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(calls.filter((c) => c !== 'today')).toEqual(['in', 'out']);
  });

  it('explains why you cannot clock in', async () => {
    state = todayView({ canClockIn: false, cannotClockInReason: "You're on leave today", day: dayView('2026-10-05', { status: 'on_leave', leave: { halfDay: null, typeName: 'Paid Leave' } }) });
    renderCard();
    expect(await screen.findByText("You're on leave today")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clock in/i })).toBeDisabled();
  });

  it("shows the server's message and its view when clocking fails", async () => {
    renderCard();
    await screen.findByText('You haven’t clocked in today.');
    // Clocked in from another tab meanwhile.
    state = todayView({ clockedIn: true, clockedInSince: '2026-10-05T04:00:00.000Z', canClockIn: false, canClockOut: true });
    await userEvent.click(screen.getByRole('button', { name: /clock in/i }));
    expect(await screen.findByText("You're already clocked in")).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /clock out/i })).toBeInTheDocument();
  });

  it('greets a holiday', async () => {
    state = todayView({ day: dayView('2026-10-05', { status: 'holiday', holidayName: 'Diwali' }) });
    renderCard();
    expect(await screen.findByText('Today is Diwali 🎉')).toBeInTheDocument();
  });
});
