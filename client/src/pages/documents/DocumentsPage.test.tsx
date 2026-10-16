import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer, type AuthState } from '../../store/auth/authSlice';
import { documentsReducer } from '../../store/documents/documentsSlice';
import type { AuthUser, EffectivePermissions } from '../../types/auth';
import DocumentsPage from './DocumentsPage';

const ROW = { id: 'd1', title: 'Handbook', description: 'Employee handbook', category: 'HR', status: 'active' };

function user(permissions: EffectivePermissions): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role: 'ORG_USER', organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions };
}

function renderPage(permissions: EffectivePermissions) {
  const preloaded: AuthState = { user: user(permissions), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = configureStore({ reducer: { documents: documentsReducer, auth: authReducer }, preloadedState: { auth: preloaded } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const READ_ONLY: EffectivePermissions = { scope: 'matrix', entries: [{ module: 'documents', read: true, create: false, update: false, delete: false }] };
const FULL: EffectivePermissions = { scope: 'all' };

describe('DocumentsPage', () => {
  it('lists documents', async () => {
    server.use(http.get(`${API_BASE_URL}/documents`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();
  });

  it('shows an empty state when there are no documents', async () => {
    server.use(http.get(`${API_BASE_URL}/documents`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })));
    renderPage(FULL);
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/documents`, () =>
        HttpResponse.json({ success: false, error: { message: "Missing 'read' permission on 'documents'" } }, { status: 403 })
      )
    );
    renderPage(FULL);
    expect(await screen.findByText(/missing 'read' permission/i)).toBeInTheDocument();
  });

  it('shows Add/Edit/Delete for a user who can create/update/delete', async () => {
    server.use(http.get(`${API_BASE_URL}/documents`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    await screen.findByText('Handbook');
    expect(screen.getByRole('button', { name: /add document/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete for a read-only user', async () => {
    server.use(http.get(`${API_BASE_URL}/documents`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(READ_ONLY);
    await screen.findByText('Handbook');
    expect(screen.queryByRole('button', { name: /add document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
