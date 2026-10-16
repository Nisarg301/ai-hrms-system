import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer, type AuthState } from '../../store/auth/authSlice';
import { projectsReducer } from '../../store/projects/projectsSlice';
import type { AuthUser, EffectivePermissions } from '../../types/auth';
import ProjectsPage from './ProjectsPage';

const ROW = { id: 'p1', name: 'Website Revamp', description: 'Redesign the marketing site', deadline: '2026-09-30T00:00:00.000Z', status: 'planning' };

function user(permissions: EffectivePermissions): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role: 'ORG_USER', organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions };
}

function renderPage(permissions: EffectivePermissions) {
  const preloaded: AuthState = { user: user(permissions), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = configureStore({ reducer: { projects: projectsReducer, auth: authReducer }, preloadedState: { auth: preloaded } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const READ_ONLY: EffectivePermissions = { scope: 'matrix', entries: [{ module: 'projects', read: true, create: false, update: false, delete: false }] };
const FULL: EffectivePermissions = { scope: 'all' };

describe('ProjectsPage', () => {
  it('lists projects', async () => {
    server.use(http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    expect(await screen.findByText('Website Revamp')).toBeInTheDocument();
    expect(screen.getByText('Redesign the marketing site')).toBeInTheDocument();
  });

  it('shows an empty state when there are no projects', async () => {
    server.use(http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })));
    renderPage(FULL);
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects`, () =>
        HttpResponse.json({ success: false, error: { message: "Missing 'read' permission on 'projects'" } }, { status: 403 })
      )
    );
    renderPage(FULL);
    expect(await screen.findByText(/missing 'read' permission/i)).toBeInTheDocument();
  });

  it('shows Add/Edit/Delete for a user who can create/update/delete', async () => {
    server.use(http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(FULL);
    await screen.findByText('Website Revamp');
    expect(screen.getByRole('button', { name: /add project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Add/Edit/Delete for a read-only user', async () => {
    server.use(http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })));
    renderPage(READ_ONLY);
    await screen.findByText('Website Revamp');
    expect(screen.queryByRole('button', { name: /add project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
