import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import type { AuthState } from '../../store/auth/authSlice';
import { makeTestStore } from '../../test/makeTestStore';
import type { AuthUser, EffectivePermissions, UserRoleName } from '../../types/auth';
import EmployeesPage from './EmployeesPage';

const ROW = { id: 'e1', name: 'Ivy', email: 'ivy@acme.com', jobTitle: 'Engineer', department: 'dep1', departmentName: 'R&D', roleId: 'r1', roleName: 'Engineer Role', status: 'active', reportsTo: 'm1', reportsToName: 'Maya Shah', joiningDate: '2026-01-05' };

function user(role: UserRoleName, permissions: EffectivePermissions): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role, organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions };
}

function renderPage(role: UserRoleName, permissions: EffectivePermissions) {
  const preloaded: AuthState = { user: user(role, permissions), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = makeTestStore({ auth: preloaded });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <EmployeesPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const FULL_EMPLOYEES_GRANT: EffectivePermissions = {
  scope: 'matrix',
  entries: [{ module: 'employees', read: true, create: true, update: true, delete: true }],
};

describe('EmployeesPage', () => {
  it('lists employees including their role', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage('ORG_ADMIN', { scope: 'all' });
    expect(await screen.findByText('Ivy')).toBeInTheDocument();
    expect(screen.getByText('ivy@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Engineer Role')).toBeInTheDocument();
    expect(screen.getByText('Maya Shah')).toBeInTheDocument();
  });

  it('shows an empty state when there are no employees', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })));
    renderPage('ORG_ADMIN', { scope: 'all' });
    expect(await screen.findByText(/no employees yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: false, error: { message: "Missing 'read' permission on 'employees'" } }, { status: 403 })));
    renderPage('ORG_ADMIN', { scope: 'all' });
    expect(await screen.findByText(/missing 'read' permission/i)).toBeInTheDocument();
  });

  it('shows Add/Edit/Delete for an Org Admin', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage('ORG_ADMIN', { scope: 'all' });
    await screen.findByText('Ivy');
    expect(screen.getByRole('button', { name: /add employee/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete for an Org User, even with every employees permission granted', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage('ORG_USER', FULL_EMPLOYEES_GRANT);
    await screen.findByText('Ivy');
    expect(screen.queryByRole('button', { name: /add employee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows the temp password modal after creating an employee', async () => {
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })));
    server.use(
      http.get(`${API_BASE_URL}/people`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/checklist-templates`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json({ success: true, data: [{ id: 'r1', name: 'Engineer Role', permissions: [] }], meta: { page: 1, limit: 10, total: 1 } })
      ),
      http.get(`${API_BASE_URL}/departments`, () =>
        HttpResponse.json({ success: true, data: [{ id: 'dep1', title: 'R&D', description: 'Research', status: 'active' }], meta: { page: 1, limit: 999999, total: 1 } })
      )
    );
    server.use(
      http.post(`${API_BASE_URL}/employees`, () =>
        HttpResponse.json({ success: true, data: { user: ROW, temp_password: 'Tmp!23456789' } }, { status: 201 })
      )
    );
    renderPage('ORG_ADMIN', { scope: 'all' });
    await userEvent.click(await screen.findByRole('button', { name: /add employee/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'Ivy');
    await userEvent.type(screen.getByLabelText(/email/i), 'ivy@acme.com');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Engineer');
    await userEvent.click(screen.getByLabelText(/department/i, { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('R&D'));
    await userEvent.click(screen.getByLabelText(/role/i, { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Engineer Role'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/Tmp!23456789/)).toBeInTheDocument());
  });

  it('tags people joining or leaving, and starts offboarding from the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
    try {
      const rows = [
        { ...ROW, lifecycle: { kind: 'onboarding', anchorDate: '2026-10-12' } },
        { ...ROW, id: 'e2', name: 'Raj', email: 'raj@acme.com', lifecycle: { kind: 'offboarding', anchorDate: '2026-10-30' } },
        { ...ROW, id: 'e3', name: 'Zoe', email: 'zoe@acme.com', lifecycle: null },
      ];
      let listCalls = 0;
      let started: unknown = null;
      server.use(
        http.get(`${API_BASE_URL}/employees`, () => {
          listCalls += 1;
          return HttpResponse.json({ success: true, data: rows, meta: { page: 1, limit: 10, total: 3 } });
        }),
        http.get(`${API_BASE_URL}/people`, () =>
          HttpResponse.json({ success: true, data: [{ id: 'e3', name: 'Zoe', jobTitle: 'Engineer', departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01' }] })
        ),
        http.get(`${API_BASE_URL}/checklist-templates`, () =>
          HttpResponse.json({ success: true, data: [{ id: 't9', name: 'Standard offboarding', kind: 'offboarding', isDefault: true, tasks: [], updatedAt: '2026-09-30T00:00:00.000Z' }] })
        ),
        http.post(`${API_BASE_URL}/lifecycle/offboarding`, async ({ request }) => {
          started = await request.json();
          return HttpResponse.json({ success: true, data: { id: 'p9', employee: { name: 'Zoe' }, tasks: [] } }, { status: 201 });
        })
      );
      renderPage('ORG_ADMIN', { scope: 'all' });
      const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

      expect(within(await rowOf('Ivy')).getByText('Onboarding')).toBeInTheDocument();
      const raj = await rowOf('Raj');
      expect(within(raj).getByText('Leaving on 30 Oct')).toBeInTheDocument();
      expect(within(raj).queryByRole('button', { name: /offboarding/i })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Start offboarding for Zoe' }));
      expect(await screen.findByText('Start offboarding for Zoe')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Last working day'), '2026-10-30{enter}');
      await userEvent.click(screen.getByLabelText('Reason'));
      await userEvent.click(await screen.findByTitle('Resignation'));
      await screen.findByTitle('Standard offboarding (default) · 0 tasks');
      await userEvent.click(screen.getByLabelText('Notes (optional)'));
      await userEvent.paste('Moving cities');
      const before = listCalls;
      await userEvent.click(screen.getByRole('button', { name: 'Start' }));

      await waitFor(() =>
        expect(started).toEqual({ employeeId: 'e3', templateId: 't9', lastWorkingDay: '2026-10-30', reason: 'resignation', adminNotes: 'Moving cities' })
      );
      await waitFor(() => expect(listCalls).toBeGreaterThan(before));
    } finally {
      vi.useRealTimers();
    }
  });
});
