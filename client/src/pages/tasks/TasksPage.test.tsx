import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import type { AuthState } from '../../store/auth/authSlice';
import { makeTestStore } from '../../test/makeTestStore';
import type { AuthUser, EffectivePermissions } from '../../types/auth';
import TasksPage from './TasksPage';

const ROW = { id: 't1', title: 'Fix login bug', description: 'Users cannot log in with SSO', dueDate: '2026-09-30', status: 'todo' };

function user(permissions: EffectivePermissions): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role: 'ORG_USER', organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions };
}

function renderPage(permissions: EffectivePermissions) {
  const preloaded: AuthState = { user: user(permissions), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = makeTestStore({ auth: preloaded });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const READ_ONLY: EffectivePermissions = { scope: 'matrix', entries: [{ module: 'tasks', read: true, create: false, update: false, delete: false }] };
const FULL: EffectivePermissions = { scope: 'all' };

describe('TasksPage', () => {
  it('lists tasks', async () => {
    server.use(http.get(`${API_BASE_URL}/tasks`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    expect(await screen.findByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('Users cannot log in with SSO')).toBeInTheDocument();
    expect(screen.getByText('2026-09-30')).toBeInTheDocument();
  });

  it('shows an empty state when there are no tasks', async () => {
    server.use(http.get(`${API_BASE_URL}/tasks`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })));
    renderPage(FULL);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/tasks`, () =>
        HttpResponse.json({ success: false, error: { message: "Missing 'read' permission on 'tasks'" } }, { status: 403 })
      )
    );
    renderPage(FULL);
    expect(await screen.findByText(/missing 'read' permission/i)).toBeInTheDocument();
  });

  it('shows Add/Edit/Delete for a user who can create/update/delete', async () => {
    server.use(http.get(`${API_BASE_URL}/tasks`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    await screen.findByText('Fix login bug');
    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete for a read-only user', async () => {
    server.use(http.get(`${API_BASE_URL}/tasks`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(READ_ONLY);
    await screen.findByText('Fix login bug');
    expect(screen.queryByRole('button', { name: /add task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
