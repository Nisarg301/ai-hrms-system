import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { attendanceBackground } from '../test/attendanceFixtures';
import { server } from '../test/setup';
import { API_BASE_URL } from '../services/api';
import type { AuthState } from '../store/auth/authSlice';
import { makeTestStore } from '../test/makeTestStore';
import type { AuthUser } from '../types/auth';
import { AppLayout } from './AppLayout';
import { navItems } from '../routes/navItems';
import { PLAN_MODULES } from '../constants/modules';

const ORG_ADMIN: AuthUser = {
  id: 'u1',
  name: 'Ann Admin',
  email: 'ann@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
};

import { ThemeProvider } from '../theme/ThemeContext';

let pendingCalls = 0;

/** `handlers` go first, so they win over the background ones. */
function renderLayout(user: AuthUser, pendingCount = 0, path = '/roles', handlers: HttpHandler[] = []) {
  pendingCalls = 0;
  server.use(
    ...handlers,
    ...attendanceBackground,
    http.get(`${API_BASE_URL}/leave/pending-count`, () => {
      pendingCalls += 1;
      return HttpResponse.json({ success: true, data: { count: pendingCount } });
    })
  );
  const preloaded: AuthState = { user, status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = makeTestStore({ auth: preloaded });
  render(
    <ThemeProvider>
      <Provider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/roles" element={<div>Roles Content</div>} />
              <Route path="/leave/approvals" element={<div>Approvals Content</div>} />
            </Route>
            <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/billing" element={<div>Billing Page</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    </ThemeProvider>
  );
  return store;
}

describe('navItems', () => {
  const canNone = () => false;
  const canAll = () => true;
  const canEmployeesRead = (module: string, action: string) => module === 'employees' && action === 'read';
  const canDocumentsRead = (module: string, action: string) => module === 'documents' && action === 'read';
  const canProjectsRead = (module: string, action: string) => module === 'projects' && action === 'read';
  const canTasksRead = (module: string, action: string) => module === 'tasks' && action === 'read';
  const canDashboardRead = (module: string, action: string) => module === 'dashboard' && action === 'read';

  it('gives a Super Admin Admin Users and Plans', () => {
    expect(navItems('SUPER_ADMIN', canNone).map((i) => i.to)).toEqual(['/admin-users', '/plans']);
  });

  it('gives an Org Admin Home, Me, the role screens and every readable module', () => {
    expect(navItems('ORG_ADMIN', canAll).map((i) => i.to)).toEqual([
      '/home', '/me', '/leave', '/people-ops', '/expenses',
      '/roles', '/employees', '/documents', '/projects', '/departments', '/tasks', '/exports', '/audit-logs',
    ]);
  });

  it('leaves out features the plan does not include', () => {
    const withoutAny = () => false;
    const items = navItems('ORG_ADMIN', canAll, withoutAny).map((i) => i.to);
    expect(items).not.toContain('/expenses');
    expect(items).not.toContain('/people-ops');
    expect(navItems('ORG_ADMIN', canAll, (f) => f === 'expenses').map((i) => i.to)).toContain('/expenses');
  });

  it('gives only an Org Admin the Approvals & leave group', () => {
    const group = navItems('ORG_ADMIN', canNone).find((i) => i.key === 'leave-management');
    expect(group?.label).toBe('Approvals & leave');
    expect(group?.children?.map((i) => i.to)).toEqual(['/leave/approvals', '/leave/team-attendance', '/leave/types', '/leave/holidays', '/leave/attendance-settings']);
    expect(navItems('ORG_USER', canAll).some((i) => i.key === 'leave-management')).toBe(false);
  });

  it('shows Exports and Audit Logs only when the plan includes them', () => {
    const onBasic = (module: string) => PLAN_MODULES.basic.includes(module as never);
    const onProfessional = (module: string) => PLAN_MODULES.professional.includes(module as never);
    expect(navItems('ORG_ADMIN', onBasic).map((i) => i.to)).not.toEqual(expect.arrayContaining(['/exports']));
    expect(navItems('ORG_ADMIN', onBasic).map((i) => i.to)).not.toContain('/audit-logs');
    expect(navItems('ORG_ADMIN', onProfessional).map((i) => i.to)).toEqual(expect.arrayContaining(['/exports', '/audit-logs']));
  });

  it('gives an Org User Home and Me plus only the modules they can read', () => {
    expect(navItems('ORG_USER', canEmployeesRead).map((i) => i.to)).toEqual(['/home', '/me', '/employees']);
    expect(navItems('ORG_USER', canDocumentsRead).map((i) => i.to)).toEqual(['/home', '/me', '/documents']);
    expect(navItems('ORG_USER', canProjectsRead).map((i) => i.to)).toEqual(['/home', '/me', '/projects']);
    expect(navItems('ORG_USER', canTasksRead).map((i) => i.to)).toEqual(['/home', '/me', '/tasks']);
    // Dashboard read no longer adds a page of its own: its counts are a card on Home.
    expect(navItems('ORG_USER', canDashboardRead).map((i) => i.to)).toEqual(['/home', '/me']);
    expect(navItems('ORG_USER', canNone).map((i) => i.to)).toEqual(['/home', '/me']);
  });
});

describe('AppLayout', () => {
  it('renders the nav for the role and the outlet content', () => {
    renderLayout(ORG_ADMIN);
    expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin Users' })).not.toBeInTheDocument();
    expect(screen.getByText('Roles Content')).toBeInTheDocument();
  });

  it('shows the signed-in user name', () => {
    renderLayout(ORG_ADMIN);
    expect(screen.getByText('Ann Admin')).toBeInTheDocument();
  });

  it('shows an icon next to each nav item', () => {
    renderLayout(ORG_ADMIN);
    const rolesLink = screen.getByRole('link', { name: 'Roles' });
    const menuItem = rolesLink.closest('.ant-menu-item');
    expect(menuItem?.querySelector('.anticon')).not.toBeNull();
  });

  it('gives an Org Admin a Billing & plan menu item', async () => {
    renderLayout(ORG_ADMIN);
    await userEvent.click(screen.getByText('Ann Admin'));
    await userEvent.click(await screen.findByText('Billing & plan'));
    expect(await screen.findByText('Billing Page')).toBeInTheDocument();
  });

  it('does not offer Billing & plan to an Org User', async () => {
    renderLayout({ ...ORG_ADMIN, role: 'ORG_USER' });
    await userEvent.click(screen.getByText('Ann Admin'));
    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(screen.queryByText('Billing & plan')).not.toBeInTheDocument();
  });

  it('signs out and returns to login', async () => {
    server.use(http.post(`${API_BASE_URL}/auth/logout`, () => HttpResponse.json({ success: true, data: { loggedOut: true } })));
    const store = renderLayout(ORG_ADMIN);

    await userEvent.click(screen.getByText('Ann Admin'));
    await userEvent.click(await screen.findByText(/sign out/i));

    expect(await screen.findByText('Login Page')).toBeInTheDocument();
    expect(store.getState().auth.user).toBeNull();
  });

  it('shows the pending approvals count on the Approvals item, and opens its group on those pages', async () => {
    renderLayout(ORG_ADMIN, 3, '/leave/approvals');
    expect(await screen.findByLabelText('3 pending')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
    expect(screen.getByText('Approvals Content')).toBeInTheDocument();
  });

  it('adds waiting expense claims and attendance requests to the badge', async () => {
    renderLayout(ORG_ADMIN, 3, '/leave/approvals', [
      http.get(`${API_BASE_URL}/expenses/pending-count`, () => HttpResponse.json({ success: true, data: { count: 4 } })),
      http.get(`${API_BASE_URL}/attendance/pending-count`, () => HttpResponse.json({ success: true, data: { regularization: 1, wfh: 1, total: 2 } })),
    ]);
    expect(await screen.findByLabelText('9 pending')).toBeInTheDocument();
  });

  it('shows no badge when nothing is pending, and never asks for it as an Org User', async () => {
    renderLayout(ORG_ADMIN, 0);
    await waitFor(() => expect(pendingCalls).toBe(1));
    expect(screen.queryByLabelText(/pending/)).not.toBeInTheDocument();

    cleanup();
    renderLayout({ ...ORG_ADMIN, role: 'ORG_USER' }, 5);
    await new Promise((r) => setTimeout(r, 50));
    expect(pendingCalls).toBe(0);
    expect(screen.queryByText('Leave management')).not.toBeInTheDocument();
  });

  it('offers the employee search and the notifications bell to org members only', () => {
    renderLayout(ORG_ADMIN);
    expect(screen.getByLabelText('Search employees')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notifications/i })).toBeInTheDocument();
    cleanup();
    renderLayout({ ...ORG_ADMIN, role: 'ORG_USER' });
    expect(screen.getByLabelText('Search employees')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notifications/i })).toBeInTheDocument();
    cleanup();
    renderLayout({ ...ORG_ADMIN, role: 'SUPER_ADMIN', organizationId: null });
    expect(screen.queryByLabelText('Search employees')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^notifications/i })).not.toBeInTheDocument();
  });

  it("shows the company's name in the header", () => {
    renderLayout({ ...ORG_ADMIN, organizationName: 'Acquaint Softtech' });
    expect(screen.getByTestId('org-name')).toHaveTextContent('Acquaint Softtech');
    expect(screen.getByTestId('org-name')).toHaveAttribute('title', 'Acquaint Softtech');
    cleanup();
    renderLayout({ ...ORG_ADMIN, role: 'SUPER_ADMIN', organizationId: null, organizationName: null });
    expect(screen.queryByTestId('org-name')).not.toBeInTheDocument();
  });
});
