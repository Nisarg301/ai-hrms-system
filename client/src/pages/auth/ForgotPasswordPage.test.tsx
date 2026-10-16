import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer } from '../../store/auth/authSlice';
import ForgotPasswordPage from './ForgotPasswordPage';

function renderPage() {
  const store = configureStore({ reducer: { auth: authReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('ForgotPasswordPage', () => {
  it('shows the reset link and token when the API returns one', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/forgot-password`, () =>
        HttpResponse.json({ success: true, data: { resetToken: 'abc123' } })
      )
    );
    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), 'ann@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if that email exists/i)).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue to reset password/i })).toHaveAttribute(
      'href',
      '/reset-password?token=abc123'
    );
  });

  it('shows the same generic confirmation and no token for an unknown email', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/forgot-password`, () =>
        HttpResponse.json({ success: true, data: { resetToken: null } })
      )
    );
    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if that email exists/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /continue to reset password/i })).not.toBeInTheDocument();
  });

  it('validates the email client-side', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
  });
});
