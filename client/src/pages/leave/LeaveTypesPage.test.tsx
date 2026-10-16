import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { LeaveType } from '../../types/leave';
import LeaveTypesPage from './LeaveTypesPage';

let types: LeaveType[];
let sent: unknown[];

beforeEach(() => {
  types = [
    { id: 't1', name: 'Paid Leave', code: 'PL', isPaid: true, yearlyQuota: 12, allowHalfDay: true, isActive: true },
    { id: 't2', name: 'Unpaid Leave', code: 'UL', isPaid: false, yearlyQuota: null, allowHalfDay: true, isActive: false },
  ];
  sent = [];
  server.use(
    http.get(`${API_BASE_URL}/leave-types`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('all')).toBe('true');
      return HttpResponse.json({ success: true, data: types });
    }),
    http.post(`${API_BASE_URL}/leave-types`, async ({ request }) => {
      const body = (await request.json()) as Omit<LeaveType, 'id'>;
      sent.push(body);
      if (body.code === 'PL') {
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { code: ['Another leave type already uses this code'] } } } },
          { status: 400 }
        );
      }
      return HttpResponse.json({ success: true, data: { id: 't9', ...body } }, { status: 201 });
    }),
    http.delete(`${API_BASE_URL}/leave-types/:id`, () =>
      HttpResponse.json({ success: false, error: { message: 'This leave type is used by pending or approved leave. Deactivate it instead.' } }, { status: 400 })
    )
  );
});

function renderPage() {
  render(
    <Provider store={makeTestStore()}>
      <LeaveTypesPage />
    </Provider>
  );
}

describe('LeaveTypesPage', () => {
  it('lists types with quota, pay and status', async () => {
    renderPage();
    const paid = (await screen.findByText('Paid Leave')).closest('tr') as HTMLElement;
    expect(within(paid).getByText('12')).toBeInTheDocument();
    expect(within(paid).getByText('Active')).toBeInTheDocument();
    const unpaid = screen.getByText('Unpaid Leave').closest('tr') as HTMLElement;
    expect(within(unpaid).getByText('Unlimited')).toBeInTheDocument();
    expect(within(unpaid).getByText('Inactive')).toBeInTheDocument();
  });

  it('validates, shows a duplicate code on the field, and adds a type', async () => {
    renderPage();
    await screen.findByText('Paid Leave');
    await userEvent.click(screen.getByRole('button', { name: /add leave type/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Code is required')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Sick Leave');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'pl');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(await within(dialog).findByText('Another leave type already uses this code')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Code'));
    await userEvent.type(within(dialog).getByLabelText('Code'), 'sl');
    await userEvent.clear(within(dialog).getByLabelText('Days per year'));
    await userEvent.type(within(dialog).getByLabelText('Days per year'), '6');
    await userEvent.click(within(dialog).getByLabelText('Half days allowed'));
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText('Sick Leave')).toBeInTheDocument());
    expect(sent.at(-1)).toEqual({ name: 'Sick Leave', code: 'SL', isPaid: true, yearlyQuota: 6, allowHalfDay: false, isActive: true });
  });

  it('allows an empty quota for unlimited', async () => {
    renderPage();
    await screen.findByText('Paid Leave');
    await userEvent.click(screen.getByRole('button', { name: /add leave type/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Comp Off');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'CO');
    await userEvent.clear(within(dialog).getByLabelText('Days per year'));
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(sent.at(-1)).toMatchObject({ code: 'CO', yearlyQuota: null }));
  });

  it("explains why a type in use can't be deleted", async () => {
    renderPage();
    await screen.findByText('Paid Leave');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Paid Leave' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('This leave type is used by pending or approved leave. Deactivate it instead.')).toBeInTheDocument();
    expect(screen.getByText('Paid Leave')).toBeInTheDocument();
  });
});
