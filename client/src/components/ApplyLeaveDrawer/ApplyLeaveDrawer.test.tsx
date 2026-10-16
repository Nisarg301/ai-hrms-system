import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { LeaveBalance } from '../../types/leave';
import { ApplyLeaveDrawer } from './ApplyLeaveDrawer';

const BALANCES: LeaveBalance[] = [
  { leaveTypeId: 't1', name: 'Paid Leave', code: 'PL', isPaid: true, allowHalfDay: true, yearlyQuota: 12, approved: 0, pending: 0, available: 12 },
  { leaveTypeId: 't2', name: 'Comp Off', code: 'CO', isPaid: true, allowHalfDay: false, yearlyQuota: null, approved: 0, pending: 0, available: null },
];

let previews: Record<string, string | null>[];
let applied: unknown[];
let balanceCalls: number;

// Only Date is faked (timers stay real for userEvent and the debounce): "today" is Mon 5 Oct 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

let balanceQueries: (string | null)[];
let recorded: unknown[];

beforeEach(() => {
  balanceQueries = [];
  recorded = [];
  previews = [];
  applied = [];
  balanceCalls = 0;
  server.use(
    http.get(`${API_BASE_URL}/leave/balances`, ({ request }) => {
      balanceCalls += 1;
      balanceQueries.push(new URL(request.url).searchParams.get('employeeId'));
      return HttpResponse.json({ success: true, data: BALANCES });
    }),
    http.get(`${API_BASE_URL}/people`, () =>
      HttpResponse.json({
        success: true,
        data: [{ id: 'e7', name: 'Ivy Mehta', jobTitle: 'Engineer', departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01' }],
      })
    ),
    http.post(`${API_BASE_URL}/leave/requests/record`, async ({ request }) => {
      recorded.push(await request.json());
      return HttpResponse.json({ success: true, data: { id: 'r9' } }, { status: 201 });
    }),
    http.get(`${API_BASE_URL}/leave/requests`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 20, total: 0 } })),
    http.get(`${API_BASE_URL}/leave/preview`, ({ request }) => {
      const q = Object.fromEntries(new URL(request.url).searchParams);
      previews.push(q);
      // Saturday–Sunday: nothing to count.
      if (q.startDate === '2026-10-10' && q.endDate === '2026-10-11') {
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { startDate: ['The selected dates are all weekends or holidays'] } } } },
          { status: 400 }
        );
      }
      const days = q.halfDay ? 0.5 : q.startDate === q.endDate ? 1 : 3;
      return HttpResponse.json({ success: true, data: { days, availableAfter: q.leaveTypeId === 't1' ? 12 - days : null } });
    }),
    http.post(`${API_BASE_URL}/leave/requests`, async ({ request }) => {
      applied.push(await request.json());
      return HttpResponse.json({ success: true, data: { id: 'r1' } }, { status: 201 });
    })
  );
});

function renderDrawer(mode: 'apply' | 'record' = 'apply') {
  const onClose = vi.fn();
  render(
    <Provider store={makeTestStore()}>
      <ApplyLeaveDrawer open onClose={onClose} mode={mode} />
    </Provider>
  );
  return onClose;
}

async function typeDate(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, `${value}{enter}`);
}

function applyButton() {
  return screen.getByRole('button', { name: 'Apply' });
}

describe('ApplyLeaveDrawer', () => {
  it('previews the working days for a range, then applies', async () => {
    const onClose = renderDrawer();
    expect(await screen.findByText('Paid Leave')).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();

    await typeDate('From', '2026-10-06');
    await typeDate('To', '2026-10-08');
    const preview = screen.getByTestId('leave-preview');
    expect(await within(preview).findByText('3 working days')).toBeInTheDocument();
    expect(preview).toHaveTextContent('9 left after this');
    expect(previews.at(-1)).toEqual({ leaveTypeId: 't1', startDate: '2026-10-06', endDate: '2026-10-08', halfDay: '' });
    expect(applyButton()).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Family trip');
    const before = balanceCalls;
    await userEvent.click(applyButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(applied).toEqual([{ leaveTypeId: 't1', startDate: '2026-10-06', endDate: '2026-10-08', halfDay: null, reason: 'Family trip' }]);
    // Balances reload after applying.
    await waitFor(() => expect(balanceCalls).toBeGreaterThan(before));
  });

  it("shows the server's reason and keeps Apply disabled when the dates don't work", async () => {
    renderDrawer();
    await screen.findByText('Paid Leave');
    await typeDate('From', '2026-10-10');
    await typeDate('To', '2026-10-11');
    expect(await screen.findByText('The selected dates are all weekends or holidays')).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
  });

  it('applies for a half day on a single date', async () => {
    renderDrawer();
    await screen.findByText('Paid Leave');
    await userEvent.click(screen.getByText('Half day'));
    await typeDate('Date', '2026-10-07');
    await userEvent.click(screen.getByLabelText('Second half'));

    expect(await within(screen.getByTestId('leave-preview')).findByText('0.5 working days')).toBeInTheDocument();
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ startDate: '2026-10-07', endDate: '2026-10-07', halfDay: 'second' }));
    await waitFor(() => expect(applyButton()).toBeEnabled());
    await userEvent.click(applyButton());
    await waitFor(() => expect(applied).toEqual([{ leaveTypeId: 't1', startDate: '2026-10-07', endDate: '2026-10-07', halfDay: 'second', reason: '' }]));
  });

  it('offers half days only for types that allow them, and shows what is available', async () => {
    renderDrawer();
    await screen.findByText('Paid Leave');
    expect(screen.getByText('12 available')).toBeInTheDocument();
    expect(screen.getByText('Half day')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Leave type'));
    await userEvent.click(await screen.findByText('Unlimited'));
    await waitFor(() => expect(screen.queryByText('Half day')).not.toBeInTheDocument());
  });

  it("won't take a date before today for my own leave", async () => {
    renderDrawer();
    await screen.findByText('Paid Leave');
    await typeDate('From', '2026-10-02');
    await typeDate('To', '2026-10-02');
    // Past dates aren't taken, so there's nothing to check and nothing to apply.
    await new Promise((r) => setTimeout(r, 450));
    expect(previews).toEqual([]);
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText('Pick your dates to see how many days this uses.')).toBeInTheDocument();

    await typeDate('From', '2026-10-05');
    expect(await within(screen.getByTestId('leave-preview')).findByText('1 working day')).toBeInTheDocument();
    expect(previews.at(-1)).toMatchObject({ startDate: '2026-10-05', endDate: '2026-10-05' });
  });

  it('lets an ORG_ADMIN record past leave for an employee, approved straight away', async () => {
    const onClose = renderDrawer('record');
    expect(screen.getByText('Record leave for an employee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record & approve' })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Employee', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Ivy Mehta · Engineer'));
    await waitFor(() => expect(balanceQueries).toContain('e7'));
    expect(await screen.findByText('Paid Leave')).toBeInTheDocument();

    // Last Friday: allowed when recording.
    await typeDate('From', '2026-10-02');
    await typeDate('To', '2026-10-02');
    expect(await within(screen.getByTestId('leave-preview')).findByText('1 working day')).toBeInTheDocument();
    expect(previews.at(-1)).toMatchObject({ employeeId: 'e7', startDate: '2026-10-02' });

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Hospital');
    await userEvent.click(screen.getByRole('button', { name: 'Record & approve' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(recorded).toEqual([{ employeeId: 'e7', leaveTypeId: 't1', startDate: '2026-10-02', endDate: '2026-10-02', halfDay: null, reason: 'Hospital' }]);
    expect(applied).toEqual([]);
    expect(await screen.findByText('Leave recorded and approved. Ivy Mehta has been emailed.')).toBeInTheDocument();
  });

  it('still limits a recording to 30 days back', async () => {
    renderDrawer('record');
    await userEvent.click(screen.getByLabelText('Employee', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Ivy Mehta · Engineer'));
    await screen.findByText('Paid Leave');
    await typeDate('From', '2026-09-01'); // 34 days back
    await typeDate('To', '2026-09-01');
    await new Promise((r) => setTimeout(r, 450));
    expect(previews).toEqual([]);

    await typeDate('From', '2026-09-07'); // 28 days back
    await typeDate('To', '2026-09-07');
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ employeeId: 'e7', startDate: '2026-09-07', endDate: '2026-09-07' }));
  });
});
