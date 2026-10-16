import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { adminUsersReducer } from '../../store/adminUsers/adminUsersSlice';
import { authReducer } from '../../store/auth/authSlice';
import AdminUsersPage from './AdminUsersPage';

const ROW = {
  id: 'a1',
  name: 'Ann Admin',
  email: 'ann@acme.com',
  organizationId: 'o1',
  organizationName: 'Acme Corp',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
};

function renderPage() {
  const store = configureStore({ reducer: { auth: authReducer, adminUsers: adminUsersReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('AdminUsersPage', () => {
  it('lists admin users including the organization name', async () => {
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, () =>
        HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })
      )
    );
    renderPage();

    expect(await screen.findByText('Ann Admin')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('ann@acme.com')).toBeInTheDocument();
  });

  it('shows an empty state when there are no admin users', async () => {
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, () =>
        HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })
      )
    );
    renderPage();

    expect(await screen.findByText(/no admin users yet/i)).toBeInTheDocument();
    expect(screen.getByText('Invite your first Org Admin to get started.')).toBeInTheDocument();
  });

  it('refetches with the search term the user typed', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } });
      })
    );
    renderPage();
    await screen.findByText('Ann Admin');

    await userEvent.type(screen.getByRole('searchbox'), 'ann');

    await waitFor(() => expect(urls.some((u) => u.includes('search=ann'))).toBe(true));
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, () =>
        HttpResponse.json({ success: false, error: { message: 'Super Admin access required' } }, { status: 403 })
      )
    );
    renderPage();

    expect(await screen.findByText('Super Admin access required')).toBeInTheDocument();
  });
});
