import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer, type AuthState } from '../../store/auth/authSlice';
import { activeSubscription, NO_PLAN } from '../../test/fixtures';
import type { AuthUser } from '../../types/auth';
import ChangePasswordPage from './ChangePasswordPage';

const USER: AuthUser = {
  id: 'u1',
  name: 'Uma User',
  email: 'uma@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: true,
  permissions: { scope: 'all' },
  subscription: activeSubscription(),
};

function renderPage(user: AuthUser = USER) {
  const preloaded: AuthState = {
    user,
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: preloaded } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/home" element={<div>Home Page</div>} />
          <Route path="/billing" element={<div>Billing Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('ChangePasswordPage', () => {
  it('rejects a new password shorter than 8 characters client-side', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/current password/i), 'temp1234');
    await userEvent.type(screen.getByLabelText(/new password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('clears mustChangePassword and redirects on success', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/change-password`, () => HttpResponse.json({ success: true, data: { changed: true } }))
    );
    const store = renderPage();

    await userEvent.type(screen.getByLabelText(/current password/i), 'temp1234');
    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Home Page')).toBeInTheDocument();
    expect(store.getState().auth.user?.mustChangePassword).toBe(false);
  });

  it('takes a newly invited Org Admin from the password change straight to Billing', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/change-password`, () => HttpResponse.json({ success: true, data: { changed: true } }))
    );
    renderPage({ ...USER, subscription: NO_PLAN });

    await userEvent.type(screen.getByLabelText(/current password/i), 'temp1234');
    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Billing Page')).toBeInTheDocument();
  });

  it('surfaces a wrong current password from the server', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/change-password`, () =>
        HttpResponse.json({ success: false, error: { message: 'Current password is incorrect' } }, { status: 400 })
      )
    );
    renderPage();

    await userEvent.type(screen.getByLabelText(/current password/i), 'wrongpass');
    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
  });
});
