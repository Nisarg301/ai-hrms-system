import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { SCHEDULE } from '../../test/attendanceFixtures';
import AttendanceSettingsPage from './AttendanceSettingsPage';

let saved: unknown[];

beforeEach(() => {
  saved = [];
  server.use(
    http.get(`${API_BASE_URL}/attendance/settings`, () => HttpResponse.json({ success: true, data: SCHEDULE })),
    http.put(`${API_BASE_URL}/attendance/settings`, async ({ request }) => {
      const body = await request.json();
      saved.push(body);
      return HttpResponse.json({ success: true, data: body });
    })
  );
});

function renderPage() {
  render(
    <Provider store={makeTestStore()}>
      <AttendanceSettingsPage />
    </Provider>
  );
}

describe('AttendanceSettingsPage', () => {
  it('shows the schedule with day lengths in hours, and saves them as minutes', async () => {
    renderPage();
    expect(await screen.findByLabelText('Shift starts')).toHaveValue('09:30');
    // Steps of half an hour, so one decimal.
    await waitFor(() => expect((screen.getByLabelText('Full day (hours)') as HTMLInputElement).value).toBe('8.0'));
    expect((screen.getByLabelText('Half day (hours)') as HTMLInputElement).value).toBe('4.0');

    await userEvent.clear(screen.getByLabelText('Full day (hours)'));
    await userEvent.type(screen.getByLabelText('Full day (hours)'), '7.5');
    await userEvent.clear(screen.getByLabelText('Grace period (minutes)'));
    await userEvent.type(screen.getByLabelText('Grace period (minutes)'), '10');
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }));
    await waitFor(() => expect(saved).toEqual([{ shiftStart: '09:30', shiftEnd: '18:30', graceMinutes: 10, fullDayMinutes: 450, halfDayMinutes: 240 }]));
  });

  it("won't save a half day longer than a full day", async () => {
    renderPage();
    await screen.findByLabelText('Half day (hours)');
    await userEvent.clear(screen.getByLabelText('Half day (hours)'));
    await userEvent.type(screen.getByLabelText('Half day (hours)'), '9');
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }));
    expect(await screen.findByText("A half day can't be longer than a full day")).toBeInTheDocument();
    expect(saved).toEqual([]);
  });
});
