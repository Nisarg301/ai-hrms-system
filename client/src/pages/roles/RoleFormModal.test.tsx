import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { PlanType } from '../../types/subscription';
import type { Role } from '../../types/role';
import { RoleFormModal } from './RoleFormModal';

/** Renders as an Org Admin whose organization is on `planType` (Professional by default). */
function renderModal(role: Role | null, planType: PlanType = 'professional') {
  const auth: AuthState = {
    user: {
      id: 'u1', name: 'Ann', email: 'ann@acme.com', role: 'ORG_ADMIN', organizationId: 'o1', roleId: null,
      mustChangePassword: false, permissions: { scope: 'all' }, subscription: activeSubscription(planType),
    },
    status: 'authenticated', bootstrapped: true, error: null, resetToken: null,
  };
  const store = makeTestStore({ auth });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <RoleFormModal open role={role} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/roles`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } }))
  );
}

describe('RoleFormModal', () => {
  it('creates a role, sending only modules that have read', async () => {
    mockList();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/roles`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { id: 'r1', name: 'Viewer', permissions: [] } }, { status: 201 });
      })
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/role name/i), 'Viewer');
    await userEvent.click(screen.getByRole('checkbox', { name: 'employees read' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'employees create' }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(body).toEqual({
        name: 'Viewer',
        permissions: [{ module: 'employees', read: true, create: true, update: false, delete: false }],
      })
    );
  });

  it('prefills the matrix when editing an existing role', () => {
    mockList();
    const role: Role = {
      id: 'r1',
      name: 'Manager',
      permissions: [{ module: 'projects', read: true, create: false, update: true, delete: false }],
    };
    renderModal(role);

    expect(screen.getByLabelText(/role name/i)).toHaveValue('Manager');
    expect(screen.getByRole('checkbox', { name: 'projects read' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'projects update' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'projects create' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'employees read' })).not.toBeChecked();
  });

  it('updates an existing role with PUT', async () => {
    mockList();
    let method = '';
    server.use(
      http.put(`${API_BASE_URL}/roles/r1`, async ({ request }) => {
        method = request.method;
        return HttpResponse.json({ success: true, data: { id: 'r1', name: 'Manager Plus', permissions: [] } });
      })
    );
    renderModal({ id: 'r1', name: 'Manager', permissions: [] });

    await userEvent.clear(screen.getByLabelText(/role name/i));
    await userEvent.type(screen.getByLabelText(/role name/i), 'Manager Plus');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
  });

  it('requires a role name', async () => {
    mockList();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/role name is required/i)).toBeInTheDocument();
  });

  it('shows Exports and Audit Logs rows on a Professional plan', () => {
    mockList();
    renderModal(null, 'professional');
    expect(screen.getByRole('checkbox', { name: 'exports read' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'auditLogs read' })).toBeInTheDocument();
  });

  it('hides modules outside a Basic plan and never sends them', async () => {
    mockList();
    let body: { permissions?: { module: string }[] } = {};
    server.use(
      http.put(`${API_BASE_URL}/roles/r1`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ success: true, data: { id: 'r1', name: 'Auditor', permissions: [] } });
      })
    );
    // A role saved while the org was on Professional, now edited on Basic.
    renderModal(
      {
        id: 'r1',
        name: 'Auditor',
        permissions: [
          { module: 'employees', read: true, create: false, update: false, delete: false },
          { module: 'auditLogs', read: true, create: false, update: false, delete: false },
        ],
      },
      'basic'
    );

    expect(screen.queryByRole('checkbox', { name: 'exports read' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'auditLogs read' })).not.toBeInTheDocument();

    // Select-all only covers the visible (Basic) modules.
    await userEvent.click(screen.getByRole('checkbox', { name: 'select all permissions' }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(body.permissions).toBeDefined());
    expect(body.permissions!.map((p) => p.module)).toEqual(['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments']);
  });

  it('surfaces a server validation error', async () => {
    mockList();
    server.use(
      http.post(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json({ success: false, error: { message: 'Validation failed' } }, { status: 400 })
      )
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/role name/i), 'Bad');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Validation failed')).toBeInTheDocument();
  });
});
