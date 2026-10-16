import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { AttendanceRequestDrawer, type AttendanceRequestMode } from './AttendanceRequestDrawer';

let sent: { path: string; body: unknown }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0)); // Mon 5 Oct 2026
  sent = [];
  server.use(
    http.post(`${API_BASE_URL}/attendance/requests`, async ({ request }) => {
      const body = (await request.json()) as { kind: string; date?: string };
      sent.push({ path: '/attendance/requests', body });
      if (body.date === '2026-10-01') {
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { date: ['You already have a fix waiting for approval on this date'] } } } },
          { status: 400 }
        );
      }
      return HttpResponse.json({ success: true, data: { id: 'r1' } }, { status: 201 });
    }),
    http.post(`${API_BASE_URL}/attendance/requests/record`, async ({ request }) => {
      sent.push({ path: '/attendance/requests/record', body: await request.json() });
      return HttpResponse.json({ success: true, data: { id: 'r2' } }, { status: 201 });
    }),
    http.get(`${API_BASE_URL}/people`, () =>
      HttpResponse.json({ success: true, data: [{ id: 'e7', name: 'Ivy Mehta', jobTitle: 'Engineer', departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01' }] })
    ),
    http.get(`${API_BASE_URL}/attendance/team`, () => HttpResponse.json({ success: true, data: { date: '2026-10-05', rows: [], counts: {}, late: 0, wfh: 0 } })),
    http.get(`${API_BASE_URL}/attendance/requests`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 20, total: 0 } }))
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function renderDrawer(mode: AttendanceRequestMode, initialDate: string | null = null) {
  const onClose = vi.fn();
  render(
    <Provider store={makeTestStore()}>
      <AttendanceRequestDrawer open mode={mode} initialDate={initialDate} onClose={onClose} />
    </Provider>
  );
  return onClose;
}

async function type(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, `${value}{enter}`);
}

describe('AttendanceRequestDrawer', () => {
  it('requests a fix with the date, times and reason', async () => {
    const onClose = renderDrawer('fix', '2026-10-02');
    expect(screen.getByText('Request an attendance fix')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveValue('02 Oct 2026');
    const send = screen.getByRole('button', { name: 'Send request' });
    expect(send).toBeDisabled();

    await type('Clock in', '09:30');
    await type('Clock out', '18:30');
    expect(send).toBeDisabled(); // still needs a reason
    await userEvent.type(screen.getByLabelText('Reason'), 'Forgot to clock out');
    await userEvent.click(send);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toEqual([{ path: '/attendance/requests', body: { kind: 'regularization', date: '2026-10-02', clockIn: '09:30', clockOut: '18:30', reason: 'Forgot to clock out' } }]);
  });

  it('warns when clock-out is not after clock-in, and shows the server reason', async () => {
    renderDrawer('fix', '2026-10-01');
    await type('Clock in', '18:00');
    await type('Clock out', '09:00');
    expect(screen.getByText('Clock-out must be after clock-in.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Reason'), 'x');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();

    await type('Clock out', '19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('You already have a fix waiting for approval on this date')).toBeInTheDocument();
  });

  it("won't take a future date for a fix", async () => {
    renderDrawer('fix');
    await type('Date', '2026-10-06');
    await type('Clock in', '09:30');
    await type('Clock out', '18:30');
    await userEvent.type(screen.getByLabelText('Reason'), 'x');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('requests work from home for a range', async () => {
    const onClose = renderDrawer('wfh');
    expect(screen.getByText('Request work from home')).toBeInTheDocument();
    await type('From', '2026-10-07');
    expect(screen.getByLabelText('To')).toHaveValue('07 Oct 2026'); // pulled along
    await type('To', '2026-10-08');
    await userEvent.type(screen.getByLabelText('Reason'), 'Plumber visit');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent[0].body).toEqual({ kind: 'wfh', startDate: '2026-10-07', endDate: '2026-10-08', reason: 'Plumber visit' });
  });

  it("lets an ORG_ADMIN fix someone's day, reason optional", async () => {
    const onClose = renderDrawer('record');
    expect(screen.getByText("Fix someone's attendance")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Employee', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Ivy Mehta · Engineer'));
    await type('Date', '2026-10-02');
    await type('Clock in', '09:00');
    await type('Clock out', '17:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save fix' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toEqual([{ path: '/attendance/requests/record', body: { employeeId: 'e7', date: '2026-10-02', clockIn: '09:00', clockOut: '17:30', reason: '' } }]);
    expect(await screen.findByText('Attendance fixed. Ivy Mehta has been emailed.')).toBeInTheDocument();
  });
});
