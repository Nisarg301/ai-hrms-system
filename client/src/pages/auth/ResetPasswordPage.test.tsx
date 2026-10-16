import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { authReducer } from '../../store/auth/authSlice';
import ResetPasswordPage from './ResetPasswordPage';

function renderPage(initialPath: string) {
  const store = configureStore({ reducer: { auth: authReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe('ResetPasswordPage', () => {
  it('prefills the token from the query string and makes it read-only', () => {
    renderPage('/reset-password?token=abc123');
    const tokenInput = screen.getByLabelText(/reset token/i);
    expect(tokenInput).toHaveValue('abc123');
    expect(tokenInput).toHaveAttribute('readonly');
  });

  it('lets the token be typed when absent from the query string', async () => {
    renderPage('/reset-password');
    const tokenInput = screen.getByLabelText(/reset token/i);
    expect(tokenInput).not.toHaveAttribute('readonly');
    await userEvent.type(tokenInput, 'pasted-token');
    expect(tokenInput).toHaveValue('pasted-token');
  });

  it('resets the password and sends the user to sign in', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/reset-password`, () => HttpResponse.json({ success: true, data: { reset: true } }))
    );
    renderPage('/reset-password?token=abc123');

    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  it('surfaces an expired or invalid token error from the server', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/reset-password`, () =>
        HttpResponse.json({ success: false, error: { message: 'Reset token is invalid or expired' } }, { status: 400 })
      )
    );
    renderPage('/reset-password?token=stale');

    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPassword123!');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText('Reset token is invalid or expired')).toBeInTheDocument();
  });
});
