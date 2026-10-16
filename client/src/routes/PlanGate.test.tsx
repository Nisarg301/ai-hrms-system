import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../test/setup';
import { API_BASE_URL } from '../services/api';
import { ORG_PLAN_EXPIRED_MESSAGE } from '../constants/plans';
import { makeTestStore } from '../test/makeTestStore';
import { activeSubscription, expiredSubscription, NO_PLAN } from '../test/fixtures';
import type { AuthState } from '../store/auth/authSlice';
import type { AuthUser, UserRoleName } from '../types/auth';
import type { Subscription } from '../types/subscription';
import { PlanGate } from './PlanGate';

function user(role: UserRoleName, subscription: Subscription | null): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role, organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'all' }, subscription };
}

function renderGate(authUser: AuthUser) {
  const auth: AuthState = { user: authUser, status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = makeTestStore({ auth });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<PlanGate />}>
            <Route path="/dashboard" element={<div>Dashboard Page</div>} />
          </Route>
          <Route path="/billing" element={<div>Billing Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('PlanGate', () => {
  it('lets users with an active plan through', () => {
    renderGate(user('ORG_ADMIN', activeSubscription('basic')));
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
  });

  it('never gates a Super Admin', () => {
    renderGate(user('SUPER_ADMIN', null));
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
  });

  it('sends an Org Admin without an active plan to Billing', () => {
    renderGate(user('ORG_ADMIN', NO_PLAN));
    expect(screen.getByText('Billing Page')).toBeInTheDocument();
  });

  it('sends an Org Admin whose plan expired to Billing', () => {
    renderGate(user('ORG_ADMIN', expiredSubscription()));
    expect(screen.getByText('Billing Page')).toBeInTheDocument();
  });

  it('signs out an Org User whose plan expired and keeps the reason for the login page', async () => {
    let loggedOut = false;
    server.use(
      http.post(`${API_BASE_URL}/auth/logout`, () => {
        loggedOut = true;
        return HttpResponse.json({ success: true, data: { loggedOut: true } });
      })
    );
    const store = renderGate(user('ORG_USER', expiredSubscription()));

    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
    await waitFor(() => expect(store.getState().auth.user).toBeNull());
    expect(store.getState().auth.status).toBe('unauthenticated');
    expect(store.getState().auth.error).toBe(ORG_PLAN_EXPIRED_MESSAGE);
    expect(loggedOut).toBe(true);
  });

  it('still signs the Org User out locally if the logout call fails', async () => {
    server.use(http.post(`${API_BASE_URL}/auth/logout`, () => HttpResponse.json({ success: false }, { status: 500 })));
    const store = renderGate(user('ORG_USER', NO_PLAN));
    await waitFor(() => expect(store.getState().auth.error).toBe(ORG_PLAN_EXPIRED_MESSAGE));
    expect(store.getState().auth.user).toBeNull();
  });
});
