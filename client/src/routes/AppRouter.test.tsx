import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { attendanceBackground } from '../test/attendanceFixtures';
import { server } from '../test/setup';
import { API_BASE_URL } from '../services/api';
import { makeTestStore } from '../test/makeTestStore';
import { activeSubscription } from '../test/fixtures';
import { ThemeProvider } from '../theme/ThemeContext';
import type { AuthState } from '../store/auth/authSlice';
import { AppRouter } from './AppRouter';

function renderAt(path: string, role: 'ORG_USER' | 'ORG_ADMIN' = 'ORG_USER') {
  server.use(...attendanceBackground);
  const auth: AuthState = {
    user: { id: 'u1', name: 'Ivy Mehta', email: 'ivy@x.com', role, organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'none' }, subscription: activeSubscription('basic') },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
  render(
    <ThemeProvider>
      <Provider store={makeTestStore({ auth })}>
        <MemoryRouter initialEntries={[path]}>
          <AppRouter />
        </MemoryRouter>
      </Provider>
    </ThemeProvider>
  );
}

describe('AppRouter', () => {
  it('sends the old /dashboard link to Home, for any member', async () => {
    server.use(
      http.get(`${API_BASE_URL}/home/summary`, () => HttpResponse.json({ success: false, error: { message: 'offline' } }, { status: 503 })),
      http.get(`${API_BASE_URL}/posts`, () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } }))
    );
    renderAt('/dashboard');
    expect(await screen.findByText(/, Ivy 👋/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it.each(['/leave/approvals', '/leave/types', '/leave/holidays', '/expenses', '/people-ops/onboarding', '/people-ops/offboarding', '/people-ops/templates'])('keeps an ORG_USER out of %s', async (path) => {
    renderAt(path);
    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(screen.queryByText('Leave management')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to your home page/i })).toBeInTheDocument();
  });
});
