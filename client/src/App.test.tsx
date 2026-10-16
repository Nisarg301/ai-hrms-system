import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './test/setup';
import { API_BASE_URL } from './services/api';
import App from './App';

describe('App', () => {
  it('renders the login screen when there is no session', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ success: false, error: { message: 'Missing refresh token' } }, { status: 401 })
      )
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
