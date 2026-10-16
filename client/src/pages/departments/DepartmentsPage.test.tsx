import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer, type AuthState } from '../../store/auth/authSlice';
import { departmentsReducer } from '../../store/departments/departmentsSlice';
import type { AuthUser, EffectivePermissions, UserRoleName } from '../../types/auth';
import DepartmentsPage from './DepartmentsPage';

const ROW = { id: 'd1', title: 'Engineering', description: 'Builds the product', status: 'active' };

function user(role: UserRoleName, permissions: EffectivePermissions): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role, organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions };
}

function renderPage(authUser: AuthUser) {
  const preloaded: AuthState = { user: authUser, status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = configureStore({ reducer: { departments: departmentsReducer, auth: authReducer }, preloadedState: { auth: preloaded } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <DepartmentsPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

function mockRows(rows: unknown[]) {
  server.use(http.get(`${API_BASE_URL}/departments`, () => HttpResponse.json({ success: true, data: rows, meta: { page: 1, limit: 10, total: rows.length } })));
}

const ORG_ADMIN = user('ORG_ADMIN', { scope: 'all' });
const EVERY_DEPARTMENTS_PERMISSION: EffectivePermissions = {
  scope: 'matrix',
  entries: [{ module: 'departments', read: true, create: true, update: true, delete: true }],
};

describe('DepartmentsPage', () => {
  it('lists departments', async () => {
    mockRows([ROW]);
    renderPage(ORG_ADMIN);
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Builds the product')).toBeInTheDocument();
  });

  it('shows an empty state when there are no departments', async () => {
    mockRows([]);
    renderPage(ORG_ADMIN);
    expect(await screen.findByText(/no departments yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/departments`, () =>
        HttpResponse.json({ success: false, error: { message: "Missing 'read' permission on 'departments'" } }, { status: 403 })
      )
    );
    renderPage(ORG_ADMIN);
    expect(await screen.findByText(/missing 'read' permission/i)).toBeInTheDocument();
  });

  it('shows Add/Edit/Delete for an Org Admin', async () => {
    mockRows([ROW]);
    renderPage(ORG_ADMIN);
    await screen.findByText('Engineering');
    expect(screen.getByRole('button', { name: /add department/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete for an Org User, even with every departments permission granted', async () => {
    mockRows([ROW]);
    renderPage(user('ORG_USER', EVERY_DEPARTMENTS_PERMISSION));
    await screen.findByText('Engineering');
    expect(screen.queryByRole('button', { name: /add department/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
