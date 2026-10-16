import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { setAccessToken } from '../../services/tokenStore';
import { authReducer } from '../../store/auth/authSlice';
import { ORG_PLAN_EXPIRED_MESSAGE } from '../../constants/plans';
import { activeSubscription, NO_PLAN } from '../../test/fixtures';
import type { AuthUser } from '../../types/auth';
import LoginPage from './LoginPage';

afterEach(() => setAccessToken(null));

const ORG_ADMIN_USER: AuthUser = {
  id: 'u1',
  name: 'Ann Admin',
  email: 'ann@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
  subscription: activeSubscription(),
};

function renderLogin() {
  const store = configureStore({ reducer: { auth: authReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/home" element={<div>Home Page</div>} />
          <Route path="/change-password" element={<div>Change Password Page</div>} />
          <Route path="/billing" element={<div>Billing Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('LoginPage', () => {
  it('shows a client-side validation error for a malformed email without calling the API', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
  });

  it('logs in and redirects to the role landing page', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'tok', user: ORG_ADMIN_USER } })
      )
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'ann@acme.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Home Page')).toBeInTheDocument();
  });

  it('redirects to change-password when the account has a temporary password', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({
          success: true,
          data: { accessToken: 'tok', user: { ...ORG_ADMIN_USER, mustChangePassword: true } },
        })
      )
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'ann@acme.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'temp1234');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Change Password Page')).toBeInTheDocument();
  });

  it('sends an Org Admin whose organization has no plan to Billing', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'tok', user: { ...ORG_ADMIN_USER, subscription: NO_PLAN } } })
      )
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'ann@acme.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Billing Page')).toBeInTheDocument();
  });

  it("shows the contact-your-admin message when an Org User's plan has expired", async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          { success: false, error: { message: ORG_PLAN_EXPIRED_MESSAGE, details: { code: 'ORG_PLAN_EXPIRED' } } },
          { status: 403 }
        )
      )
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'uma@acme.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(ORG_PLAN_EXPIRED_MESSAGE)).toBeInTheDocument();
  });

  it('shows the server error message on bad credentials', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: false, error: { message: 'Invalid email or password' } }, { status: 401 })
      )
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'ann@acme.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeInTheDocument());
  });
});
